import express from "express";
import router from "./routes";

const app = express();

app.use(express.json());
app.use("/api/vault", router);

const PORT = process.env.PORT ?? 3000;

app.listen(PORT, () => {
  console.log("Started listening on port: ", PORT);
});
