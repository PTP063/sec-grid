/**
 * Represents the current state and metadata of a node in the mesh network.
 */
export interface NodeMetadata {
  id: string;
  status: 'ACTIVE' | 'INACTIVE';
  lastSeen: number;
  isSelf: boolean;
}

export type PacketType = 'HEARTBEAT' | 'DATA' | 'ACK';

/**
 * Header information for a network packet, used for routing and deduplication.
 */
export interface PacketHeader {
  packetId: string;
  senderId: string;
  targetId?: string;
  ttl: number;
  timestamp: number;
  type: PacketType;
}

/**
 * The complete network packet wrapping the header and generic payload.
 */
export interface NetworkPacket<T = unknown> {
  header: PacketHeader;
  payload: T;
}

/**
 * Callback type for listening to incoming packets.
 */
export type PacketListener<T = unknown> = (packet: NetworkPacket<T>) => void;

/**
 * Callback type for listening to changes in the active node list.
 */
export type NodeListListener = (nodes: NodeMetadata[]) => void;
