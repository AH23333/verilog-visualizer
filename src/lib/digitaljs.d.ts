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
    stop(): void;
    shutdown?(): void;
  }
}

export {};