import { parseEnv } from "@server/variants/effect-postgres/env";
import { describeEnvCases } from "./env-postgres.cases";

describeEnvCases("effect", parseEnv);
