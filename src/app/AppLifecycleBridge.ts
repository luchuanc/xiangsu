/**
 * 页面生命周期桥接只产生稳定信号，不在这里挑选快照或直接保存。
 * 调用方收到 hidden/pagehide 后再提供已经完成领域事务的 candidate。
 */
export type AppLifecycleSignal = "hidden" | "visible" | "pagehide";
export type AppLifecycleSignalListener = (signal: AppLifecycleSignal) => void;

export interface AppLifecycleEventTarget extends EventTarget {
  visibilityState?: "hidden" | "visible" | "prerender";
}

export interface AppLifecycleBridgeOptions {
  documentTarget?: AppLifecycleEventTarget;
  windowTarget?: EventTarget;
  onSignal: AppLifecycleSignalListener;
}

export class AppLifecycleBridge {
  private readonly documentTarget: AppLifecycleEventTarget | undefined;
  private readonly windowTarget: EventTarget | undefined;
  private readonly onSignal: AppLifecycleSignalListener;
  private attached = false;

  public constructor(options: AppLifecycleBridgeOptions) {
    this.documentTarget = options.documentTarget;
    this.windowTarget = options.windowTarget;
    this.onSignal = options.onSignal;
  }

  public attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.documentTarget?.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.windowTarget?.addEventListener("pagehide", this.handlePageHide);
  }

  public detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.documentTarget?.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.windowTarget?.removeEventListener("pagehide", this.handlePageHide);
  }

  public get isAttached(): boolean {
    return this.attached;
  }

  private readonly handleVisibilityChange = (): void => {
    this.onSignal(this.documentTarget?.visibilityState === "hidden" ? "hidden" : "visible");
  };

  private readonly handlePageHide = (): void => {
    this.onSignal("pagehide");
  };
}

