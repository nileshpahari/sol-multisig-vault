import { Router } from "express";
import {
	approveProposal,
	cancelProposal,
	createProposal,
	createVault,
	getProposal,
	getVault,
	getVaultData,
	listProposals,
} from "./controller";

const router = Router();

// POST /api/vault/create — Create a multi-sig vault
router.post("/create", createVault);

// GET /api/vault/:vaultId — Get vault details
router.get("/:vaultId", getVault);

// POST /api/vault/:vaultId/propose — Create a proposal
router.post("/:vaultId/propose", createProposal);

// POST /api/vault/:vaultId/proposals/:proposalId/approve — Approve a proposal
router.post(
	"/:vaultId/proposals/:proposalId/approve",
	approveProposal,
);

// GET /api/vault/:vaultId/proposals — List proposals
router.get("/:vaultId/proposals", listProposals);

// GET /api/vault/:vaultId/proposals/:proposalId — Get proposal details
router.get("/:vaultId/proposals/:proposalId", getProposal);

// POST /api/vault/:vaultId/proposals/:proposalId/cancel — Cancel a proposal
router.post(
	"/:vaultId/proposals/:proposalId/cancel",
	cancelProposal,
);

// GET /api/vault/:vaultId/data — Get vault data store
router.get("/:vaultId/data", getVaultData);

export default router;
