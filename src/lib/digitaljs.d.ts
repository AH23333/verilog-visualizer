declare global {
  interface Window {
    digitaljs: {
      Circuit: new (json: any, opts?: any) => DigitalJSCircuit;
      HeadlessCircuit: new (json: any) => any;
      Monitor: any;
      MonitorView: any;
      IOPanelView: any;
      cells: Record<string, any>;
      engines: Record<string, any>;
      tools: Record<string, any>;
      getCellType: (name: string) => any;
      paperOptions: any;
    };
  }

  interface DigitalJSCircuit {
    displayOn(elem: HTMLElement): any;
    start(): void;
    startFast?(): void;
    stop(opts?: any): void;
    shutdown?(): void;
    /** engine tick interval in ms (lower = faster simulation) */
    interval?: number;
    /** whether the simulation engine is currently running */
    running?: boolean;
    /** joint.mvc.Events mixin — e.g. 'changeRunning' */
    on?(event: string, cb: (...args: any[]) => void): void;
    off?(event: string, cb?: (...args: any[]) => void): void;
    hasWarnings?(): boolean;
    toJSON?(layout?: boolean): any;
    updateGates?(opts?: any): void;
    updateGatesNext?(opts?: any): void;
  }
}

export {};