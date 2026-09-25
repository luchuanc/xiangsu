import { describe, expect, it } from "vitest";
import {
  AudioService,
  type AudioBufferSourceNodeLike,
  type AudioContextLike,
  type AudioGainNodeLike,
  type AudioParamLike,
} from "../../src/app/AudioService";

class FakeAudioParam implements AudioParamLike {
  public value = 0;
  public readonly calls: Array<{ name: string; value: number; time: number }> = [];

  public setValueAtTime(value: number, startTime: number): this {
    this.value = value;
    this.calls.push({ name: "set", value, time: startTime });
    return this;
  }

  public linearRampToValueAtTime(value: number, endTime: number): this {
    this.value = value;
    this.calls.push({ name: "ramp", value, time: endTime });
    return this;
  }

  public cancelScheduledValues(startTime: number): this {
    this.calls.push({ name: "cancel", value: this.value, time: startTime });
    return this;
  }
}

class FakeGain implements AudioGainNodeLike {
  public readonly gain = new FakeAudioParam();
  public connectedTo: unknown[] = [];

  public connect(destination: unknown): unknown {
    this.connectedTo.push(destination);
    return destination;
  }

  public disconnect(): void {
    this.connectedTo = [];
  }
}

class FakeSource implements AudioBufferSourceNodeLike {
  public buffer = null;
  public loop = false;
  public onended: ((event: Event) => unknown) | null = null;
  public readonly starts: number[] = [];
  public readonly stops: number[] = [];

  public connect(): unknown {
    return undefined;
  }

  public start(when = 0): void {
    this.starts.push(when);
  }

  public stop(when = 0): void {
    this.stops.push(when);
  }

  public disconnect(): void {
    // fake source 无需额外释放。
  }
}

class FakeAudioContext implements AudioContextLike {
  public currentTime = 10;
  public readonly destination = {};
  public readonly gains: FakeGain[] = [];
  public readonly sources: FakeSource[] = [];
  public resumeCount = 0;
  public suspendCount = 0;
  public closeCount = 0;
  public state: "suspended" | "running" | "closed" = "suspended";

  public createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  public createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  public async resume(): Promise<void> {
    this.resumeCount += 1;
    this.state = "running";
  }

  public async suspend(): Promise<void> {
    this.suspendCount += 1;
    this.state = "suspended";
  }

  public async close(): Promise<void> {
    this.closeCount += 1;
    this.state = "closed";
  }
}

const buffer = { duration: 1 };

describe("AudioService", () => {
  it("锁前丢弃 SFX，解锁后从当前 BGM 目标音量直接启动", async () => {
    const context = new FakeAudioContext();
    const service = new AudioService({ context });
    service.registerBuffer("bgm_field", buffer);
    service.registerBuffer("sfx_hit", buffer);
    service.setMusic("bgm_field", 5000);

    expect(service.playSfx("sfx_hit")).toBe(false);
    expect(context.sources).toHaveLength(0);

    await service.unlock();
    expect(context.resumeCount).toBe(1);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.starts).toEqual([10]);
    expect(context.gains.at(-1)?.gain.calls.at(-1)).toEqual({
      name: "set",
      value: 0.3,
      time: 10,
    });
  });

  it("同轨 scene gain 线性 ramp，换轨 200ms 交叉淡化", async () => {
    const context = new FakeAudioContext();
    const service = new AudioService({ context });
    service.registerBuffer("bgm_field", buffer);
    service.registerBuffer("bgm_town", buffer);
    await service.unlock();

    service.setMusic("bgm_field", 10000);
    const oldSource = context.sources[0];
    const oldGain = context.gains.at(-1);
    expect(oldSource?.starts).toEqual([10]);
    expect(oldGain?.gain.calls.at(-1)).toEqual({ name: "ramp", value: 0.6, time: 10.2 });

    service.setMusic("bgm_field", 5000);
    expect(oldGain?.gain.calls.at(-1)).toEqual({ name: "ramp", value: 0.3, time: 10.2 });

    service.setMusic("bgm_town", 10000);
    const newSource = context.sources[1];
    expect(oldSource?.stops).toEqual([10.2]);
    expect(newSource?.starts).toEqual([10]);
    expect(context.gains.at(-1)?.gain.calls.slice(-2)).toEqual([
      { name: "set", value: 0, time: 10 },
      { name: "ramp", value: 0.6, time: 10.2 },
    ]);
  });

  it("严格校验 ID、场景倍率和用户音量，SFX 不带 scene 倍率", async () => {
    const context = new FakeAudioContext();
    const service = new AudioService({ context });
    service.registerBuffer("sfx_hit", buffer);
    await service.unlock();
    service.setUserVolume("sfx", 0);
    expect(service.playSfx("sfx_hit")).toBe(true);
    expect(context.gains.at(-1)?.gain.calls.at(-1)?.value).toBe(0);
    service.setUserVolume("sfx", 100);
    expect(service.playSfx("sfx_hit")).toBe(true);
    expect(context.gains.at(-1)?.gain.calls.at(-1)?.value).toBe(0.7);

    expect(() => service.setMusic("unknown" as never, 10000)).toThrow("未知 music ID");
    expect(() => service.setMusic("bgm_field", 1.5)).toThrow(RangeError);
    expect(() => service.setUserVolume("music", 50.5)).toThrow(RangeError);
    expect(() => service.setUserVolume("other" as never, 50)).toThrow("未知音频通道");
  });

  it("后台 suspend/resume 不覆盖用户音量，销毁关闭上下文", async () => {
    const context = new FakeAudioContext();
    const service = new AudioService({ context });
    service.setUserVolume("music", 0);
    await service.unlock();
    await service.suspend();
    await service.resumeIfUnlocked();
    expect(context.suspendCount).toBe(1);
    expect(context.resumeCount).toBe(2);
    expect(service.getState().userMusicVolume).toBe(0);
    service.destroy();
    expect(context.closeCount).toBe(1);
  });
});
