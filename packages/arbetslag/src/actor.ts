import { Chan, Receiver, Sender } from "ts-chan";

const STOP = Symbol("STOP");

export abstract class Actor<I, O> {
    private inputChannel: Chan<I | typeof STOP>;
    protected outputChannel: Chan<O>;

    constructor() {
        this.inputChannel = new Chan<I | typeof STOP>(1);
        this.outputChannel = new Chan<O>(1);
    }


    async send(input: I): Promise<void> {
        await this.inputChannel.send(input);
    }

    async stop(): Promise<void> {
        await this.inputChannel.send(STOP);
    }

    start(): Receiver<O> {
        (async () => {
            for await (const input of this.inputChannel) {
                if (input === STOP) {
                    this.outputChannel.close();
                    break;
                }
                await this.process(input);
            }
        })();
        return this.outputChannel;
    }

    protected abstract process(input: I): Promise<void>;
}