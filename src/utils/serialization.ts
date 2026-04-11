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
