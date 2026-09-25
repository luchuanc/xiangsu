export const MUSIC_IDS = [
  "bgm_title",
  "bgm_town",
  "bgm_field",
  "bgm_abyss",
  "bgm_boss",
  "bgm_final_boss",
] as const;

export const SFX_IDS = [
  "sfx_ui_confirm",
  "sfx_ui_cancel",
  "sfx_ui_error",
  "sfx_step",
  "sfx_encounter",
  "sfx_attack",
  "sfx_skill",
  "sfx_hit",
  "sfx_heal",
  "sfx_status",
  "sfx_combo_unlock",
  "sfx_combo_trigger",
  "sfx_loot_rare",
  "sfx_loot_abyss",
  "sfx_boss_phase",
  "sfx_battle_result",
] as const;

export type MusicId = (typeof MUSIC_IDS)[number];
export type SfxId = (typeof SFX_IDS)[number];
export type AudioChannel = "music" | "sfx";

export const MUSIC_BASE_GAIN_BPS: Readonly<Record<MusicId, number>> = {
  bgm_title: 6500,
  bgm_town: 6000,
  bgm_field: 6000,
  bgm_abyss: 6000,
  bgm_boss: 7000,
  bgm_final_boss: 7500,
};

export const SFX_BASE_GAIN_BPS: Readonly<Record<SfxId, number>> = {
  sfx_ui_confirm: 7000,
  sfx_ui_cancel: 6500,
  sfx_ui_error: 7000,
  sfx_step: 3500,
  sfx_encounter: 8000,
  sfx_attack: 7000,
  sfx_skill: 7500,
  sfx_hit: 7000,
  sfx_heal: 7000,
  sfx_status: 6500,
  sfx_combo_unlock: 8500,
  sfx_combo_trigger: 8000,
  sfx_loot_rare: 8000,
  sfx_loot_abyss: 9000,
  sfx_boss_phase: 8500,
  sfx_battle_result: 8000,
};

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): AudioParamLike;
  linearRampToValueAtTime(value: number, endTime: number): AudioParamLike;
  cancelScheduledValues(startTime: number): AudioParamLike;
}

export interface AudioGainNodeLike {
  gain: AudioParamLike;
  connect(destination: unknown): unknown;
  disconnect?(): void;
}

export interface AudioBufferLike {
  readonly duration?: number;
}

export interface AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  onended: ((event: Event) => unknown) | null;
  connect(destination: unknown): unknown;
  start(when?: number): void;
  stop(when?: number): void;
  disconnect?(): void;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  readonly state?: "suspended" | "running" | "closed" | string;
  createGain(): AudioGainNodeLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  /** Web Audio 原生解码；旧 Node fake 可不实现，调用时会返回明确解码失败。 */
  decodeAudioData?(data: ArrayBuffer): Promise<AudioBufferLike>;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

export type AudioContextFactory = () => AudioContextLike;

export interface AudioServiceOptions {
  context?: AudioContextLike;
  contextFactory?: AudioContextFactory;
  rampMs?: number;
}

interface ActiveMusic {
  id: MusicId;
  source: AudioBufferSourceNodeLike;
  gain: AudioGainNodeLike;
}

interface ActiveSfx {
  id: SfxId;
  source: AudioBufferSourceNodeLike;
}

const MUSIC_ID_SET = new Set<string>(MUSIC_IDS);
const SFX_ID_SET = new Set<string>(SFX_IDS);
const DEFAULT_RAMP_MS = 200;

function isMusicId(value: string): value is MusicId {
  return MUSIC_ID_SET.has(value);
}

function isSfxId(value: string): value is SfxId {
  return SFX_ID_SET.has(value);
}

function assertSceneGain(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new RangeError("sceneMusicGainBps 必须是 0～10000 的整数");
  }
}

function assertUserVolume(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new RangeError("用户音量必须是 0～100 的整数");
  }
}

function nowOf(context: AudioContextLike): number {
  return Number.isFinite(context.currentTime) ? context.currentTime : 0;
}

function createBrowserAudioContext(): AudioContextLike {
  const globalAudio = globalThis as typeof globalThis & {
    webkitAudioContext?: new () => AudioContextLike;
  };
  const ContextConstructor = globalAudio.AudioContext ?? globalAudio.webkitAudioContext;
  if (!ContextConstructor) {
    throw new Error("AUDIO_CONTEXT_UNAVAILABLE");
  }

  return new ContextConstructor();
}

/**
 * 管理封闭音频 ID、用户音量和 Web Audio 生命周期；领域事件不在此层解释。
 */
export class AudioService {
  private readonly contextFactory: AudioContextFactory;
  private readonly rampMs: number;
  private readonly buffers = new Map<string, AudioBufferLike>();
  private readonly bufferUsage = new Map<string, number>();
  private readonly pendingUnregister = new Set<string>();
  private context: AudioContextLike | null;
  private musicOutput: AudioGainNodeLike | null = null;
  private sfxOutput: AudioGainNodeLike | null = null;
  private activeMusic: ActiveMusic | null = null;
  private readonly activeSfx = new Set<ActiveSfx>();
  private targetMusicId: MusicId | null = null;
  private sceneMusicGainBps = 10000;
  private userMusicVolume = 100;
  private userSfxVolume = 100;
  private unlocked = false;
  private destroyed = false;

  public constructor(options: AudioServiceOptions = {}) {
    this.context = options.context ?? null;
    this.contextFactory = options.contextFactory ?? createBrowserAudioContext;
    this.rampMs = options.rampMs ?? DEFAULT_RAMP_MS;
    if (!Number.isFinite(this.rampMs) || this.rampMs <= 0) {
      throw new RangeError("rampMs 必须是有限正数");
    }
  }

  public registerBuffer(id: MusicId | SfxId, buffer: AudioBufferLike): void {
    this.assertAlive();
    this.assertKnownId(id);
    if (!buffer) {
      throw new TypeError("AudioBuffer 不能为空");
    }

    this.buffers.set(id, buffer);
    this.pendingUnregister.delete(id);
    if (this.unlocked && this.targetMusicId !== null && this.activeMusic === null) {
      this.startMusic(this.targetMusicId, true);
    }
  }

  /**
   * 资源层在 owner bundle 归零时调用；活跃 source 仍引用 buffer 时延迟到 onended。
   */
  public unregisterBuffer(id: MusicId | SfxId): void {
    this.assertAlive();
    this.assertKnownId(id);
    if ((this.bufferUsage.get(id) ?? 0) > 0) {
      this.pendingUnregister.add(id);
      return;
    }
    this.buffers.delete(id);
    this.pendingUnregister.delete(id);
  }

  public getRegisteredBuffer(id: MusicId | SfxId): AudioBufferLike | undefined {
    this.assertKnownId(id);
    return this.buffers.get(id);
  }

  /** 显式解码入口；用户手势解锁状态不参与资源解码。 */
  public async decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike> {
    this.assertAlive();
    if (!(data instanceof ArrayBuffer)) {
      throw new TypeError("音频解码输入必须是 ArrayBuffer");
    }
    const context = this.ensureContext();
    if (!context.decodeAudioData) {
      throw new Error("AUDIO_DECODE_UNAVAILABLE");
    }
    return context.decodeAudioData(data);
  }

  public setMusic(id: MusicId | null, sceneGainBps: number): void {
    this.assertAlive();
    assertSceneGain(sceneGainBps);
    if (id !== null) {
      this.assertMusicId(id);
    }

    const previousId = this.targetMusicId;
    this.targetMusicId = id;
    this.sceneMusicGainBps = sceneGainBps;

    if (!this.unlocked) {
      return;
    }

    const context = this.ensureContext();
    const now = nowOf(context);
    if (id === null) {
      this.fadeAndStop(this.activeMusic, now);
      this.activeMusic = null;
      return;
    }

    if (previousId === id && this.activeMusic?.id === id) {
      this.rampActiveMusic(now);
      return;
    }

    this.fadeAndStop(this.activeMusic, now);
    this.activeMusic = null;
    this.startMusic(id, false);
  }

  public playSfx(id: SfxId): boolean {
    this.assertAlive();
    this.assertSfxId(id);

    // 用户手势解锁前的 SFX 丢弃，解锁后不补播。
    if (!this.unlocked) {
      return false;
    }

    const buffer = this.buffers.get(id);
    if (!buffer) {
      return false;
    }

    const context = this.ensureContext();
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = false;
    const active: ActiveSfx = { id, source };
    this.retainBuffer(id);
    source.onended = () => {
      this.activeSfx.delete(active);
      this.releaseBuffer(id);
    };
    gain.gain.setValueAtTime(this.getSfxGain(id), nowOf(context));
    source.connect(gain);
    gain.connect(this.sfxOutput ?? context.destination);
    this.activeSfx.add(active);
    try {
      source.start(nowOf(context));
    } catch (error) {
      this.activeSfx.delete(active);
      this.releaseBuffer(id);
      throw error;
    }
    return true;
  }

  public setUserVolume(channel: AudioChannel, value: number): void {
    this.assertAlive();
    assertUserVolume(value);
    if (channel === "music") {
      this.userMusicVolume = value;
      if (this.activeMusic !== null && this.context !== null) {
        const now = nowOf(this.context);
        this.activeMusic.gain.gain.cancelScheduledValues(now);
        this.activeMusic.gain.gain.setValueAtTime(this.getMusicGain(this.activeMusic.id), now);
      }
      return;
    }
    if (channel === "sfx") {
      this.userSfxVolume = value;
      return;
    }

    throw new Error(`未知音频通道: ${String(channel)}`);
  }

  public async unlock(): Promise<void> {
    this.assertAlive();
    const context = this.ensureContext();
    if (this.unlocked) {
      if (context.state === "suspended") {
        await context.resume();
      }
      if (this.targetMusicId !== null && this.activeMusic === null) {
        this.startMusic(this.targetMusicId, true);
      }
      return;
    }
    await context.resume();
    this.unlocked = true;
    if (this.targetMusicId !== null && this.activeMusic === null) {
      // 首次解锁直接落在目标音量，不把用户未解锁前的淡化过程补播出来。
      this.startMusic(this.targetMusicId, true);
    }
  }

  public async suspend(): Promise<void> {
    if (this.destroyed || this.context === null) {
      return;
    }
    await this.context.suspend();
  }

  public async resumeIfUnlocked(): Promise<void> {
    if (this.destroyed || !this.unlocked || this.context === null) {
      return;
    }

    await this.context.resume();
    if (this.targetMusicId !== null && this.activeMusic === null) {
      this.startMusic(this.targetMusicId, true);
    }
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    const context = this.context;
    if (context !== null) {
      const now = nowOf(context);
      this.stopImmediately(this.activeMusic, now);
    }
    this.activeMusic = null;
    for (const active of this.activeSfx) {
      try {
        active.source.stop(context === null ? 0 : nowOf(context));
      } catch {
        // source 已结束时无需重复抛出。
      }
      active.source.disconnect?.();
    }
    this.activeSfx.clear();
    this.bufferUsage.clear();
    this.pendingUnregister.clear();
    this.buffers.clear();

    this.context = null;
    this.musicOutput?.disconnect?.();
    this.sfxOutput?.disconnect?.();
    this.musicOutput = null;
    this.sfxOutput = null;
    if (context !== null) {
      void context.close().catch(() => undefined);
    }
  }

  public getState(): {
    unlocked: boolean;
    targetMusicId: MusicId | null;
    userMusicVolume: number;
    userSfxVolume: number;
  } {
    return {
      unlocked: this.unlocked,
      targetMusicId: this.targetMusicId,
      userMusicVolume: this.userMusicVolume,
      userSfxVolume: this.userSfxVolume,
    };
  }

  private ensureContext(): AudioContextLike {
    if (this.context === null) {
      this.context = this.contextFactory();
      this.musicOutput = this.context.createGain();
      this.sfxOutput = this.context.createGain();
      this.musicOutput.gain.setValueAtTime(1, nowOf(this.context));
      this.sfxOutput.gain.setValueAtTime(1, nowOf(this.context));
      this.musicOutput.connect(this.context.destination);
      this.sfxOutput.connect(this.context.destination);
    }

    return this.context;
  }

  private startMusic(id: MusicId, immediate: boolean): void {
    const buffer = this.buffers.get(id);
    if (!buffer) {
      return;
    }

    const context = this.ensureContext();
    const source = context.createBufferSource();
    const gain = context.createGain();
    const now = nowOf(context);
    const targetGain = this.getMusicGain(id);
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    gain.connect(this.musicOutput ?? context.destination);
    if (immediate) {
      gain.gain.setValueAtTime(targetGain, now);
    } else {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(targetGain, now + this.rampMs / 1000);
    }
    source.onended = () => {
      if (this.activeMusic?.source === source) {
        this.activeMusic = null;
      }
      this.releaseBuffer(id);
    };
    this.retainBuffer(id);
    const active: ActiveMusic = { id, source, gain };
    this.activeMusic = active;
    try {
      source.start(now);
    } catch (error) {
      // source.start 失败也必须回收 usage；否则 bundle 归零时会永久 pending unregister。
      if (this.activeMusic === active) this.activeMusic = null;
      this.releaseBuffer(id);
      source.disconnect?.();
      gain.disconnect?.();
      throw error;
    }
  }

  private rampActiveMusic(now: number): void {
    if (this.activeMusic === null) {
      return;
    }

    const targetGain = this.getMusicGain(this.activeMusic.id);
    this.activeMusic.gain.gain.cancelScheduledValues(now);
    this.activeMusic.gain.gain.setValueAtTime(this.activeMusic.gain.gain.value, now);
    this.activeMusic.gain.gain.linearRampToValueAtTime(
      targetGain,
      now + this.rampMs / 1000,
    );
  }

  private fadeAndStop(active: ActiveMusic | null, now: number): void {
    if (active === null) {
      return;
    }

    active.gain.gain.cancelScheduledValues(now);
    active.gain.gain.setValueAtTime(active.gain.gain.value, now);
    active.gain.gain.linearRampToValueAtTime(0, now + this.rampMs / 1000);
    try {
      active.source.stop(now + this.rampMs / 1000);
    } catch {
      // 已停止的 source 只需完成当前淡出，不再向调用方抛出生命周期噪声。
    }
  }

  private stopImmediately(active: ActiveMusic | null, now: number): void {
    if (active === null) {
      return;
    }
    active.gain.gain.cancelScheduledValues(now);
    active.gain.gain.setValueAtTime(0, now);
    try {
      active.source.stop(now);
    } catch {
      // destroy 可重复调用，已停止 source 不构成错误。
    }
    active.source.disconnect?.();
    active.gain.disconnect?.();
  }

  private retainBuffer(id: MusicId | SfxId): void {
    this.bufferUsage.set(id, (this.bufferUsage.get(id) ?? 0) + 1);
  }

  private releaseBuffer(id: MusicId | SfxId): void {
    const count = this.bufferUsage.get(id) ?? 0;
    if (count <= 1) this.bufferUsage.delete(id);
    else this.bufferUsage.set(id, count - 1);
    if ((this.bufferUsage.get(id) ?? 0) === 0 && this.pendingUnregister.has(id)) {
      this.buffers.delete(id);
      this.pendingUnregister.delete(id);
    }
  }

  private getMusicGain(id: MusicId): number {
    return (
      (MUSIC_BASE_GAIN_BPS[id] / 10000) *
      (this.userMusicVolume / 100) *
      (this.sceneMusicGainBps / 10000)
    );
  }

  private getSfxGain(id: SfxId): number {
    return (SFX_BASE_GAIN_BPS[id] / 10000) * (this.userSfxVolume / 100);
  }

  private assertKnownId(id: string): void {
    if (!isMusicId(id) && !isSfxId(id)) {
      throw new Error(`未知音频 ID: ${id}`);
    }
  }

  private assertMusicId(id: string): asserts id is MusicId {
    if (!isMusicId(id)) {
      throw new Error(`未知 music ID: ${id}`);
    }
  }

  private assertSfxId(id: string): asserts id is SfxId {
    if (!isSfxId(id)) {
      throw new Error(`未知 sfx ID: ${id}`);
    }
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("AudioService 已销毁");
    }
  }
}
