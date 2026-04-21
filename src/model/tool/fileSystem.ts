import { z } from "zod";
import { Context } from "../context";
import { Session } from "../session";
import { Tool } from ".";

export const ReadDocumentInputSchema = z
  .object({
    path: z.string().describe("Document path to read from."),
    offset: z
      .number()
      .describe("Byte offset to start reading from.")
      .optional(),
    length: z
      .number()
      .describe(
        "Number of bytes to read. Due to limited context window, the suggested value is 4096.",
      )
      .optional(),
  })
  .describe(
    "Read a document from the file system. Note: you have a limited context window, so always use offset and length when reading large files.",
  ) satisfies z.ZodTypeAny;

export const WriteDocumentInputSchema = z
  .object({
    path: z.string().describe("Document path to write to."),
    content: z.string().describe("Content to write to the document."),
  })
  .describe("Write content to a new document.") satisfies z.ZodTypeAny;

export const EditDocumentInputSchema = z
  .object({
    path: z.string().describe("Document path to edit."),
    offset: z.number().describe("Byte offset to start editing from."),
    length: z.number().describe("Number of bytes to replace."),
    content: z.string().describe("Content to edit the document with."),
  })
  .describe("Edit an existing document.") satisfies z.ZodTypeAny;

export const ListDocumentsInputSchema = z
  .object({
    path: z.string().describe("Directory path to list documents from."),
  })
  .describe("List documents in a directory.") satisfies z.ZodTypeAny;

export const DeleteDocumentInputSchema = z
  .object({
    path: z.string().describe("Document path to delete."),
  })
  .describe("Delete a document from the file system.") satisfies z.ZodTypeAny;

class Write implements Tool<typeof WriteDocumentInputSchema, "success"> {
  static name: string = "writeDocument";
  description: string = "Write content to a new document.";
  inputSchema = WriteDocumentInputSchema;
  constructor() {}
  async handler(
    context: Context,
    session: Session,
    input: z.infer<typeof WriteDocumentInputSchema>,
  ): Promise<"success"> {
    await context.fileSystem.writeFile(input.path, input.content);
    return "success";
  }
}

class Read implements Tool<typeof ReadDocumentInputSchema, string> {
  static name: string = "readDocument";
  description: string = "Read the content of a document.";
  inputSchema = ReadDocumentInputSchema;
  constructor() {}
  async handler(
    context: Context,
    session: Session,
    input: z.infer<typeof ReadDocumentInputSchema>,
  ): Promise<string> {
    const fullContent = (await context.fileSystem.readFile(input.path)) || "";
    if (input.offset !== undefined) {
      const start = Math.max(0, input.offset);
      const end =
        input.length !== undefined ? start + input.length : fullContent.length;
      return fullContent.slice(start, end);
    }
    return fullContent;
  }
}

class Replace implements Tool<typeof EditDocumentInputSchema, "success"> {
  static name: string = "editDocument";
  description: string =
    "Edit content of a document, replace existing content in range [offset, offset + length) with new content.";
  inputSchema = EditDocumentInputSchema;
  constructor() {}
  async handler(
    context: Context,
    session: Session,
    input: z.infer<typeof EditDocumentInputSchema>,
  ): Promise<"success"> {
    await context.fileSystem.editFile(
      input.path,
      input.content,
      input.offset,
      input.length,
    );
    return "success";
  }
}

class List implements Tool<typeof ListDocumentsInputSchema, string[]> {
  static name: string = "listDocuments";
  description: string = "List all documents in a directory.";
  inputSchema = ListDocumentsInputSchema;
  constructor() {}
  async handler(
    context: Context,
    session: Session,
    input: z.infer<typeof ListDocumentsInputSchema>,
  ): Promise<string[]> {
    return await context.fileSystem.listFiles(input.path);
  }
}

class Delete implements Tool<typeof DeleteDocumentInputSchema, "success"> {
  static name: string = "deleteDocument";
  description: string = "Delete a document.";
  inputSchema = DeleteDocumentInputSchema;
  constructor() {}
  async handler(
    context: Context,
    session: Session,
    input: z.infer<typeof DeleteDocumentInputSchema>,
  ): Promise<"success"> {
    await context.fileSystem.deleteFile(input.path);
    return "success";
  }
}

export { Write, Read, Replace, List, Delete };
