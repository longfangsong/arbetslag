import { z } from "zod";
import { Tool } from "@/model/tool";
import { Context } from "@/model/context";
import { Session } from "@/model/session";


export const ReadDocumentInputSchema = z.object({
    path: z.string().describe("Document path to read from."),
    offset: z.number().describe("Byte offset to start reading from.").optional(),
    length: z.number().describe("Number of bytes to read.").optional(),
}) satisfies z.ZodTypeAny;

export const WriteDocumentInputSchema = z.object({
    path: z.string().describe("Document path to write to."),
    content: z.string().describe("Content to write to the document."),
}) satisfies z.ZodTypeAny;

export const EditDocumentInputSchema = z.object({
    path: z.string().describe("Document path to edit."),
    offset: z.number().describe("Byte offset to start editing from."),
    length: z.number().describe("Number of bytes to replace."),
    content: z.string().describe("Content to edit the document with."),
}) satisfies z.ZodTypeAny;

export const ListDocumentsInputSchema = z.object({
    path: z.string().describe("Directory path to list documents from."),
}) satisfies z.ZodTypeAny;

export const DeleteDocumentInputSchema = z.object({
    path: z.string().describe("Document path to delete."),
}) satisfies z.ZodTypeAny;

class Write implements Tool<typeof WriteDocumentInputSchema, "success"> {
    name: string = "writeDocument";
    description: string = "Write content to a new document.";
    inputSchema = WriteDocumentInputSchema;
    constructor() { }
    async handler(context: Context, session: Session, input: z.infer<typeof WriteDocumentInputSchema>): Promise<"success"> {
        await session.fileSystem.writeFile(input.path, input.content);
        return "success";
    }
}

class Read implements Tool<typeof ReadDocumentInputSchema, string> {
    name: string = "readDocument";
    description: string = "Read the content of a document.";
    inputSchema = ReadDocumentInputSchema;
    constructor() { }
    async handler(context: Context, session: Session, input: z.infer<typeof ReadDocumentInputSchema>): Promise<string> {
        const fullContent = await session.fileSystem.readFile(input.path) || "";
        if (input.offset !== undefined) {
            const start = Math.max(0, input.offset);
            const end = input.length !== undefined ? start + input.length : fullContent.length;
            return fullContent.slice(start, end);
        }
        return fullContent;
    }
}

class Replace implements Tool<typeof EditDocumentInputSchema, "success"> {
    name: string = "editDocument"
    description: string = "Edit content of a document, replace existing content in range [offset, offset + length) with new content.";
    inputSchema = EditDocumentInputSchema;
    constructor() { }
    async handler(context: Context, session: Session, input: z.infer<typeof EditDocumentInputSchema>): Promise<"success"> {
        await session.fileSystem.editFile(input.path, input.content, input.offset, input.length);
        return "success";
    }
}

class List implements Tool<typeof ListDocumentsInputSchema, string[]> {
    name: string = "listDocuments";
    description: string = "List all documents in a directory.";
    inputSchema = ListDocumentsInputSchema;
    constructor() { }
    async handler(context: Context, session: Session, input: z.infer<typeof ListDocumentsInputSchema>): Promise<string[]> {
        return await session.fileSystem.listFiles(input.path);
    }
}

class Delete implements Tool<typeof DeleteDocumentInputSchema, 'success'> {
    name: string = "deleteDocument"
    description: string = "Delete a document.";
    inputSchema = DeleteDocumentInputSchema
    constructor() { }
    async handler(context: Context, session: Session, input: z.infer<typeof DeleteDocumentInputSchema>): Promise<'success'> {
        await session.fileSystem.deleteFile(input.path);
        return 'success';
    }
}

export { Write, Read, Replace, List, Delete };
