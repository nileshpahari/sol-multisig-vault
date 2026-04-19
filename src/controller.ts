import type { Request, Response } from "express";
import { PublicKey } from "@solana/web3.js";
import crypto from "crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";

const PROGRAM_ID = "11111111111111111111111111111111";
let vaultId = 1;
let proposalId = 1;

interface Signature {
	signer: string;
	createdAt: string;
}

interface Proposal {
	id: number;
	vaultId: number;
	proposer: string;
	action: "set_data" | "transfer" | "memo";
	params: object;
	status: "pending" | "executed" | "cancelled";
	signatures: Signature[];
	createdAt: string;
	executedAt?: string;
}

interface Vault {
	id: number;
	label: string;
	address: string;
	threshold: number;
	bump: number;
	signers: string[];
	proposals: Proposal[];
	data: Record<string, string>;
	createdAt: string;
}

const vaults: Map<number, Vault> = new Map();
const vaultByAddress: Map<string, Vault> = new Map();

const parsePubkey = (address: string): PublicKey | null => {
	try {
		return new PublicKey(address);
	} catch (error) {
		return null;
	}
};

export const createVault = (req: Request, res: Response) => {
	const { signers, label } = req.body;
	const threshold = parseInt(req.body.threshold);

	if (typeof label !== "string" || label.trim() === "") {
		return res.status(400).json({ error: "Invalid label" });
	}

	if (!signers || !Array.isArray(signers) || signers.length < 2) {
		return res.status(400).json({ error: "Invalid signers" });
	}

	if (!threshold || isNaN(threshold) || threshold > signers.length || threshold < 1) {
		return res.status(400).json({ error: "Invalid threshold" });
	}

	const allUnique = new Set(signers).size === signers.length;

	if (!allUnique) {
		return res.status(400).json({ error: "Invalid signers" });
	}

	try {
		signers.map((s) => new PublicKey(s));
	} catch (error) {
		return res.status(400).json({ error: "Invalid signers" });
	}

	signers.sort();
	const sha256Hash = crypto
		.createHash("sha256")
		.update(signers.join(":"))
		.digest();

	const [address, bump] = PublicKey.findProgramAddressSync(
		[Buffer.from("vault"), sha256Hash],
		new PublicKey(PROGRAM_ID),
	);

	if (vaultByAddress.has(address.toBase58())) {
		return res
			.status(409)
			.json({ error: "Vault with same signer set already exists" });
	}

	const vault: Vault = {
		id: vaultId++,
		label,
		threshold,
		address: address.toBase58(),
		bump,
		signers,
		proposals: [],
		data: {},
		createdAt: new Date().toISOString(),
	};

	vaults.set(vault.id, vault);
	vaultByAddress.set(vault.address, vault);

	return res.status(201).json({
		id: vault.id,
		label: vault.label,
		address: vault.address,
		threshold: vault.threshold,
		bump: vault.bump,
		signers: vault.signers,
		createdAt: vault.createdAt,
	});
};

export const getVault = (req: Request, res: Response) => {
	const id = parseInt(req.params.vaultId as string);

	const vault = vaults.get(id);
	if (!vault) {
		return res.status(404).json({ error: "Vault not found" });
	}

	return res.status(200).json({
		id: vault.id,
		label: vault.label,
		address: vault.address,
		threshold: vault.threshold,
		bump: vault.bump,
		signers: vault.signers,
		proposalCount: vault.proposals.length,
		createdAt: vault.createdAt,
	});
};

export const createProposal = (req: Request, res: Response) => {
	const { proposer, action, params } = req.body;
	const vaultId = parseInt(req.params.vaultId as string);

	if (!proposer || !action || !params) {
		return res.status(400).json({ error: "Missing required filed" });
	}

	if (!["transfer", "set_data", "memo"].includes(action)) {
		return res.status(400).json({ error: "Invalid action" });
	}

	if (action === "transfer") {
		if (
			typeof params?.to !== "string" ||
			!parsePubkey(params.to) ||
			typeof params?.amount !== "number" ||
			params.amount <= 0
		) {
			return res.status(400).json({ error: "Invalid params" });
		}
	}

	else if (action === "set_data") {
		if (
			typeof params?.key !== "string" ||
			params.key.trim() === "" ||
			typeof params?.value !== "string" ||
			params.value.trim() === ""
		) {
			return res.status(400).json({ error: "Invalid params" });
		}
	}

	else if (action === "memo") {
		if (
			typeof params?.content !== "string" ||
			params.content.trim() === ""
		) {
			return res.status(400).json({ error: "Invalid params" });
		}
	}

	else {
		return res.status(400).json({ error: "Invalid action" });
	}

	const vault = vaults.get(vaultId);
	if (!vault) {
		return res.status(404).json({ error: "Vault not found" });
	}

	if (!vault.signers.includes(proposer)) {
		return res.status(403).json({ error: "Not a vault signer" });
	}

	const proposal: Proposal = {
		id: proposalId++,
		vaultId: vault.id,
		proposer,
		action,
		params,
		status: "pending",
		signatures: [],
		createdAt: new Date().toISOString(),
	};

	vault.proposals.push(proposal);

	return res.status(201).json(proposal);
};

export const approveProposal = (req: Request, res: Response) => {
	const vaultId = parseInt(req.params.vaultId as string);
	const proposalId = parseInt(req.params.proposalId as string);
	const { signer, signature } = req.body;

	const vault = vaults.get(vaultId);
	if (!vault) {
		return res.status(404).json({ error: "Vault not found" });
	}
	const proposal = vault.proposals.find((p) => p.id === proposalId);
	if (!proposal) {
		return res.status(404).json({ error: "Proposal not found" });
	}

	if (!vault.signers.includes(signer)) {
		return res.status(403).json({ error: "Not a vault signer" });
	}

	try {
		const signatureBytes = bs58.decode(signature);
		const valid = nacl.sign.detached.verify(
			Buffer.from(`approve:${proposalId}`, "utf-8"),
			signatureBytes,
			new PublicKey(signer).toBuffer(),
		);

		if (!valid) {
			return res.status(400).json({ error: "Invalid signature" });
		}

		if (proposal.signatures.some((s) => s.signer === signer)) {
			return res.status(409).json({ error: "Already signed" });
		}

		if (proposal.status === "executed") {
			return res.status(409).json({ error: "Proposal already executed" });
		}

		if (proposal.status === "cancelled") {
			return res.status(409).json({ error: "Proposal cancelled" });
		}

		proposal.signatures.push({ signer, createdAt: new Date().toISOString() });
		if (proposal.signatures.length >= vault.threshold) {
			if (proposal.action === "set_data") {
				const params = proposal.params as { key: string; value: string };
				vault.data[params.key] = params.value;
			}

			if (proposal.action === "transfer") {
				// simulated
			}

			if (proposal.action === "memo") {
				// simulated
			}

			proposal.executedAt = new Date().toISOString();
			proposal.status = "executed";
		}
	} catch {
		return res.status(400).json({ error: "Invalid signature" });
	}

	const response: any = {
		id: proposal.id,
		vaultId: proposal.vaultId,
		proposer: proposal.proposer,
		action: proposal.action,
		params: proposal.params,
		status: proposal.status,
		signatures: proposal.signatures,
	};

	if (proposal.executedAt) {
		response.executedAt = proposal.executedAt;
	}

	res.status(200).json(response);
};

export const listProposals = (req: Request, res: Response) => {
	const vaultId = parseInt(req.params.vaultId as string);
	const status = req.query.status as string | undefined;

	const vault = vaults.get(vaultId);
	if (!vault) {
		return res.status(404).json({ error: "Vault not found" });
	}

	let proposals = vault.proposals;
	if (status && ["pending", "executed", "cancelled"].includes(status)) {
		proposals = proposals.filter((p) => p.status === status);
	}

	return res.status(200).json(
		proposals.map((p) => {
			const response: any = {
				id: p.id,
				vaultId: p.vaultId,
				proposer: p.proposer,
				action: p.action,
				params: p.params,
				status: p.status,
				signatures: p.signatures,
				createdAt: p.createdAt,
			};
			if (p.executedAt) {
				response.executedAt = p.executedAt;
			}
			return response;
		}),
	);
};

export const getProposal = (req: Request, res: Response) => {
	const vaultId = parseInt(req.params.vaultId as string);
	const proposalId = parseInt(req.params.proposalId as string);

	const vault = vaults.get(vaultId);
	if (!vault) {
		return res.status(404).json({ error: "Vault not found" });
	}

	const proposal = vault.proposals.find((p) => p.id === proposalId);
	if (!proposal) {
		return res.status(404).json({ error: "Proposal not found" });
	}

	const response: any = {
		id: proposal.id,
		vaultId: proposal.vaultId,
		proposer: proposal.proposer,
		action: proposal.action,
		params: proposal.params,
		status: proposal.status,
		signatures: proposal.signatures,
		createdAt: proposal.createdAt,
	};

	if (proposal.executedAt) {
		response.executedAt = proposal.executedAt;
	}

	return res.status(200).json(response);
};

export const cancelProposal = (req: Request, res: Response) => {
	const vaultId = parseInt(req.params.vaultId as string);
	const proposalId = parseInt(req.params.proposalId as string);
	const { signer, signature } = req.body;

	const vault = vaults.get(vaultId);
	if (!vault) {
		return res.status(404).json({ error: "Vault not found" });
	}

	const proposal = vault.proposals.find((p) => p.id === proposalId);
	if (!proposal) {
		return res.status(404).json({ error: "Proposal not found" });
	}

	if (signer !== proposal.proposer) {
		return res.status(403).json({ error: "Only the proposer can cancel" });
	}

	try {
		const signatureBytes = bs58.decode(signature);
		const valid = nacl.sign.detached.verify(
			Buffer.from(`cancel:${proposalId}`),
			signatureBytes,
			new PublicKey(signer).toBuffer(),
		);

		if (!valid) {
			return res.status(400).json({ error: "Invalid signature" });
		}

		if (proposal.status == "executed") {
			return res.status(409).json({ error: "Proposal already executed" });
		}

		if (proposal.status == "cancelled") {
			return res.status(409).json({ error: "Proposal already cancelled" });
		}

		proposal.status = "cancelled";
	} catch (error) {
		return res.status(400).json({ error: "Invalid signature" });
	}

	const response: any = {
		id: proposal.id,
		vaultId: proposal.vaultId,
		proposer: proposal.proposer,
		action: proposal.action,
		params: proposal.params,
		status: proposal.status,
		signatures: proposal.signatures,
		createdAt: proposal.createdAt,
	};

	return res.status(200).json(response);
};

export const getVaultData = (req: Request, res: Response) => {
	const vaultId = parseInt(req.params.vaultId as string);

	const vault = vaults.get(vaultId);
	if (!vault) {
		return res.status(404).json({ error: "Vault not found" });
	}

	return res.status(200).json({ data: vault.data });
};
