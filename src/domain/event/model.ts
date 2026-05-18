export interface ToolCallEvent {
    id: string;
    to_agent_id: string;
    event_type: 'tool_call';
    payload: {
        id?: string;
        tool_name: string;
        arguments: Record<string, any>;
    };
}

export interface MessageEvent {
    id: string;
    chat_id: string;
    adapter: string;
    event_type: 'message';
    payload: {
        content: string;
    };
}

export interface ToolResponseEvent {
    id: string;
    to_agent_id: string;
    event_type: 'tool_response';
    payload: {
        tool_call_id?: string;
        name: string;
        content: string;
    };
}

export interface ApiCallbackEvent {
    id: string;
    to_agent_id?: string;
    event_type: 'api_callback';
    payload: {
        api_name: string;
        content: string;
    };
}

export type Event = ToolCallEvent | MessageEvent | ToolResponseEvent | ApiCallbackEvent;
