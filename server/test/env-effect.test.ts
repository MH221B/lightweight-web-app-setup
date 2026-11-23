import { parseEnv } from "@server/variants/effect/env";
import { describeEnvCases } from "./env.cases";

describeEnvCases("effect", parseEnv);
