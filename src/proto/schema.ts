export const schemaProtoStr = `syntax = "proto3";

enum Priority {
  LOW = 0;
  HIGH = 1;
  CRITICAL = 2;
}

enum PacketType {
  HEARTBEAT = 0;
  DATA = 1;
  ACK = 2;
}

enum TriageMethod {
  MANUAL = 0;
  HEURISTIC = 1;
  MANUAL_OVERRIDE = 2;
}

// Inner triage payload
message TriageSOS {
  bytes id = 1;          // 16-byte compacted UUID
  bytes sender = 2;      // 16-byte compacted UUID
  Priority priority = 3;
  string medicalNeed = 4;
  string hazard = 5;
  uint64 timestamp = 6;
  string status = 7;
  TriageMethod triageMethod = 8;
}

// Outer network envelope for zero-knowledge multi-hop relaying
message NetworkEnvelope {
  bytes packetId = 1;          // 16-byte compacted UUID
  bytes sender = 2;            // 16-byte compacted UUID
  bytes recipient = 3;         // 16-byte compacted UUID (empty if broadcast)
  uint32 ttl = 4;              // Time-to-live hop counter
  uint32 copiesLeft = 5;       // Spray-and-Wait DTN spray quota
  uint32 sequenceNum = 6;      // Monotonic sequence number for replay defense
  PacketType type = 7;         // HEARTBEAT | DATA | ACK
  uint64 timestamp = 8;        // Wall-clock hint for telemetry
  bytes encryptedPayload = 9;  // Raw sealed ciphertext: [12-byte IV][Ciphertext + 16-byte GCM Tag]
}
`;
