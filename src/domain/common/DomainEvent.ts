/**
 * 所有领域事件共用的最小基类。
 * 具体事件的判别字段和 payload 由内容/战斗契约在后续任务中定义。
 */
export class DomainEvent {
  public readonly eventId: string;
  public readonly sequence: number;

  public constructor(eventId: string, sequence: number) {
    if (typeof eventId !== "string" || eventId.length === 0) {
      throw new TypeError("eventId 必须是非空字符串");
    }
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new RangeError("sequence 必须是非负安全整数");
    }

    this.eventId = eventId;
    this.sequence = sequence;
  }
}
