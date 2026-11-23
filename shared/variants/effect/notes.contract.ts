import { oc } from "@orpc/contract";
import { Schema, SchemaTransformation } from "effect";
import { NOTE_MAX_LENGTH, NOTES_CREATE_STATUS, NOTES_PATH } from "../../notes.meta";

export { NOTE_MAX_LENGTH };
const note = Schema.Struct({ id: Schema.Number, text: Schema.String, createdAt: Schema.String });
const noteText = Schema.String.pipe(Schema.decode(SchemaTransformation.trim())).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(NOTE_MAX_LENGTH),
);

export const notesContract = {
  list: oc
    .route({ method: "GET", path: NOTES_PATH })
    .output(
      Schema.toStandardSchemaV1(Schema.Struct({ notes: Schema.mutable(Schema.Array(note)) })),
    ),
  create: oc
    .route({ method: "POST", path: NOTES_PATH, successStatus: NOTES_CREATE_STATUS })
    .input(Schema.toStandardSchemaV1(Schema.Struct({ text: noteText })))
    .output(Schema.toStandardSchemaV1(Schema.Struct({ note }))),
};
