export class Logger {
    private static _instance: Logger;
    private _enabled: boolean = false;
  
    private constructor() {}
  
    public static getInstance(): Logger {
      if (!Logger._instance) {
        Logger._instance = new Logger();
      }
      return Logger._instance;
    }
  
    public setEnabled(enabled: boolean): void {
      this._enabled = enabled;
    }
  
    public log(...args: any[]): void {
      if (this._enabled) {
        console.log(...args);
      }
    }
  
    public error(...args: any[]): void {
      // Always log errors regardless of enabled state
      console.error(...args);
    }
  
    public warn(...args: any[]): void {
      if (this._enabled) {
        console.warn(...args);
      }
    }
  
    public info(...args: any[]): void {
      if (this._enabled) {
        console.info(...args);
      }
    }
  }
  
  export const logger = Logger.getInstance();