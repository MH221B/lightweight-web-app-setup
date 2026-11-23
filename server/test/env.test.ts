import { parseEnv } from "@server/env";
import { describeEnvCases } from "./env.cases";

describeEnvCases("zod", parseEnv);
