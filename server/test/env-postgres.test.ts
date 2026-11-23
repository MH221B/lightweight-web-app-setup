import { parseEnv } from "@server/variants/postgres/env";
import { describeEnvCases } from "./env-postgres.cases";

describeEnvCases("zod", parseEnv);
