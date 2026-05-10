import { z } from "zod";
import { Result } from "neverthrow";
import { Context } from "../context";
import { Tool, ok, err } from ".";

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

class Write implements Tool<typeof WriteDocumentInputSchema, {}> {
  static toolName: string = "writeDocument";
  description: string = "Write content to a new document.";
  inputSchema = WriteDocumentInputSchema;
  constructor() {}
  async handler(
    context: Context,
    _agentId: string,
    input: z.infer<typeof WriteDocumentInputSchema>,
  ): Promise<Result<{}, string>> {
    try {
      await context.fileSystem.writeFile(input.path, input.content);
      return ok({});
    } catch (e) {
      return err(`Failed to write file: ${(e as Error).message}`);
    }
  }
}

class Read implements Tool<typeof ReadDocumentInputSchema, string> {
  static toolName: string = "readDocument";
  description: string = "Read the content of a document.";
  inputSchema = ReadDocumentInputSchema;
  constructor() {}
  async handler(
    context: Context,
    _agentId: string,
    input: z.infer<typeof ReadDocumentInputSchema>,
  ): Promise<Result<string, string>> {
    try {
      const fullContent = (await context.fileSystem.readFile(input.path)) || "";
      if (input.offset !== undefined) {
        const start = Math.max(0, input.offset);
        const end =
          input.length !== undefined ? start + input.length : fullContent.length;
        return ok(fullContent.slice(start, end));
      }
      return ok(fullContent);
    } catch (e) {
      return err(`Failed to read file: ${(e as Error).message}`);
    }
  }
}

class Replace implements Tool<typeof EditDocumentInputSchema, {}> {
  static toolName: string = "editDocument";
  description: string =
    "Edit content of a document, replace existing content in range [offset, offset + length) with new content.";
  inputSchema = EditDocumentInputSchema;
  constructor() {}
  async handler(
    context: Context,
    _agentId: string,
    input: z.infer<typeof EditDocumentInputSchema>,
  ): Promise<Result<{}, string>> {
    try {
      await context.fileSystem.editFile(
        input.path,
        input.content,
        input.offset,
        input.length,
      );
      return ok({});
    } catch (e) {
      return err(`Failed to edit file: ${(e as Error).message}`);
    }
  }
}

class List implements Tool<typeof ListDocumentsInputSchema, string[]> {
  static toolName: string = "listDocuments";
  description: string = "List all documents in a directory.";
  inputSchema = ListDocumentsInputSchema;
  constructor() {}
  async handler(
    context: Context,
    _agentId: string,
    input: z.infer<typeof ListDocumentsInputSchema>,
  ): Promise<Result<string[], string>> {
    try {
      return ok(await context.fileSystem.listFiles(input.path));
    } catch (e) {
      return err(`Failed to list files: ${(e as Error).message}`);
    }
  }
}

class Delete implements Tool<typeof DeleteDocumentInputSchema, {}> {
  static toolName: string = "deleteDocument";
  description: string = "Delete a document.";
  inputSchema = DeleteDocumentInputSchema;
  constructor() {}
  async handler(
    context: Context,
    _agentId: string,
    input: z.infer<typeof DeleteDocumentInputSchema>,
  ): Promise<Result<{}, string>> {
    try {
      await context.fileSystem.deleteFile(input.path);
      return ok({});
    } catch (e) {
      return err(`Failed to delete file: ${(e as Error).message}`);
    }
  }
}

export { Write, Read, Replace, List, Delete };
