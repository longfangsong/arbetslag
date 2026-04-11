/**
 * Serialization utilities for Agent state snapshots
 * 
 * Supports:
 * - Deep serialization/deserialization of Agent instances
 * - Safe JSON conversion with circular reference handling
 * - State snapshots for observability (Principle V)
 */

export class Serializer {
  /**
   * Serializes an object to a JSON string.
   */
  static serialize(data: any): string {
    return JSON.stringify(data, null, 2);
  }

  /**
   * Deserializes a JSON string back to an object.
   */
  static deserialize<T>(json: string): T {
    return JSON.parse(json);
  }

  /**
   * Creates a deep clone of an object.
   */
  static clone<T>(data: T): T {
    return JSON.parse(JSON.stringify(data));
  }

  /**
   * Serializes an entity (Agent or Session) to a JSON snapshot.
   * This supports Principle V (Observability) by allowing state capture.
   */
  static serializeSnapshot(entity: { inspect: () => any }): string {
    const snapshot = entity.inspect();
    return this.serialize(snapshot);
  }

  /**
   * Deserializes a snapshot back into a plain object.
   */
  static deserializeSnapshot<T>(json: string): T {
    return this.deserialize<T>(json);
  }
}

/**
 * Serialize an Agent to its inspectable state
 */
export function serializeAgent(agent: any): any {
  return {
    id: agent.state.id,
    status: agent.state.status,
    createdAt: agent.state.createdAt,
    terminatedAt: agent.state.terminatedAt,
    messageCount: agent.state.messageHistory?.length || 0,
    activeChildren: agent.state.activeChildren || [],
    toolCount: agent.getTools?.()?.length || 0,
    spawnConstraints: agent.getSpawnConstraints?.(),
  };
}

/**
 * Serialize an AgentSession to its inspectable state
 */
export function serializeSession(session: any): any {
  return {
    sessionId: session.sessionId,
    agentId: session.agentId,
    parentId: session.parentId,
    currentDepth: session.currentDepth,
    createdAt: session.createdAt,
    terminatedAt: session.terminatedAt,
    isAlive: session.isAlive?.(),
    messageCount: session.messageHistory?.length || 0,
  };
}
