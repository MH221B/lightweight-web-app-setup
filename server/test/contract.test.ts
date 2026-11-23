import { notesContract } from "@shared/notes.contract";
import { describeContractCases } from "./contract.cases";

const { inputSchema, outputSchema } = notesContract.create["~orpc"];
if (!inputSchema || !outputSchema) throw new Error("notes contract is missing create schemas");

describeContractCases({
  name: "zod",
  checkInput: (input) => inputSchema.parse(input),
  checkOutput: (value) => outputSchema.parse(value),
});
