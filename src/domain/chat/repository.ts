import { Chat } from "./model";

export class Repository {
    public chats: Array<Chat> = [];

    async getById(id: string): Promise<Chat | null> {
        return this.chats.find(chat => chat.id === id) || null;
    }
}