import { Chat } from "./model";

export class Repository {
    public chats: Array<Chat>;

    constructor(chats: Array<Chat> = []) {
        this.chats = chats;
    }

    async getById(id: string): Promise<Chat | null> {
        return this.chats.find(chat => chat.id === id) || null;
    }
}