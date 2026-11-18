import { oc } from "@orpc/contract";
import { Schema, SchemaTransformation } from "effect";

export const NOTE_MAX_LENGTH = 200;
const note = Schema.Struct({ id: Schema.Number, text: Schema.String, createdAt: Schema.String });
const noteText = Schema.String.pipe(Schema.decode(SchemaTransformation.trim())).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(NOTE_MAX_LENGTH),
);

export const notesContract = {
  list: oc
    .route({ method: "GET", path: "/api/notes" })
    .output(
      Schema.toStandardSchemaV1(Schema.Struct({ notes: Schema.mutable(Schema.Array(note)) })),
    ),
  create: oc
    .route({ method: "POST", path: "/api/notes", successStatus: 201 })
    .input(Schema.toStandardSchemaV1(Schema.Struct({ text: noteText })))
    .output(Schema.toStandardSchemaV1(Schema.Struct({ note }))),
};
