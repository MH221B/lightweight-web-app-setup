import { notesContract } from "@shared/variants/effect/notes.contract";
import { describeContractCases, standardCheck } from "./contract.cases";

const { inputSchema, outputSchema } = notesContract.create["~orpc"];
if (!inputSchema || !outputSchema) throw new Error("notes contract is missing create schemas");

describeContractCases({
  name: "effect",
  checkInput: (input) => standardCheck(inputSchema, input),
  checkOutput: (value) => standardCheck(outputSchema, value),
});
