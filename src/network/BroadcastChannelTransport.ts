import type { ITransport } from './ITransport';

/**
 * Fallback In-Browser Transport utilizing BroadcastChannel.
 *
 * Facilitates multi-tab local testing, simulation, and desktop browser execution
 * without requiring native mobile BLE hardware.
 */
export class BroadcastChannelTransport implements ITransport {
  private channel: BroadcastChannel | null = null;
  private readonly channelName: string;
  private receiveCallbacks: Set<(rawBytes: Uint8Array) => void> = new Set();
  private isStarted = false;

  constructor(channelName = 'mesh-os-broadcast-channel') {
    this.channelName = channelName;
  }

  public async start(): Promise<void> {
    if (this.isStarted && this.channel) return;

    this.channel = new BroadcastChannel(this.channelName);
    this.channel.onmessage = this.handleMessage.bind(this);
    this.isStarted = true;
  }

  public async stop(): Promise<void> {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.receiveCallbacks.clear();
    this.isStarted = false;
  }

  public async send(rawBytes: Uint8Array): Promise<void> {
    if (!this.channel) {
      await this.start();
    }
    if (this.channel) {
      // Send raw binary buffer across tabs
      this.channel.postMessage(rawBytes);
    }
  }

  public onReceive(callback: (rawBytes: Uint8Array) => void): void {
    this.receiveCallbacks.add(callback);
  }

  private handleMessage(event: MessageEvent): void {
    const data = event.data;
    if (data instanceof Uint8Array) {
      for (const cb of this.receiveCallbacks) {
        try {
          cb(data);
        } catch (err) {
          console.error('[BroadcastChannelTransport] Error in receive callback:', err);
        }
      }
    } else if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      for (const cb of this.receiveCallbacks) {
        try {
          cb(bytes);
        } catch (err) {
          console.error('[BroadcastChannelTransport] Error in receive callback:', err);
        }
      }
    }
  }
}
