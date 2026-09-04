/**
 * Standardized Transport Layer Interface for Mesh·OS.
 *
 * Decouples the upper routing and gossip layer (MeshNode, WAL, Envelope)
 * from the underlying physical or virtual medium (Bluetooth Low Energy, BroadcastChannel, WebRTC).
 */
export interface ITransport {
  /**
   * Broadcasts or sends raw binary frame bytes across the transport medium.
   *
   * @param rawBytes Serialized binary envelope (Protobuf + AES-GCM ciphertext)
   */
  send(rawBytes: Uint8Array): Promise<void>;

  /**
   * Registers a callback invoked whenever incoming raw binary frame bytes
   * are received from an adjacent peer or medium.
   *
   * @param callback Handler accepting incoming frame bytes
   */
  onReceive(callback: (rawBytes: Uint8Array) => void): void;

  /**
   * Initializes and activates the underlying hardware radio or communication channel.
   */
  start(): Promise<void>;

  /**
   * Gracefully shuts down active scans, advertisements, or channels, releasing hardware resources.
   */
  stop(): Promise<void>;
}
