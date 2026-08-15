import { create } from 'zustand';
import { MeshNode } from '../network/MeshNode';
import type { NodeMetadata } from '../network/types';

export type NodeRole = 'FIELD_RADIO' | 'BASE_STATION';

interface MeshState {
  meshNode: MeshNode | null;
  metadataList: NodeMetadata[];
  peerjsId: string | null;
  nodeRole: NodeRole;
  encryptionKey: string;
  
  initMesh: (signalingServer?: { host: string, port: number, path: string }) => void;
  destroyMesh: () => void;
  connectToPeer: (id: string) => void;
  setNodeRole: (role: NodeRole) => void;
  setEncryptionKey: (key: string) => void;
}

export const useMeshStore = create<MeshState>((set, get) => ({
  meshNode: null,
  metadataList: [],
  peerjsId: null,
  nodeRole: 'FIELD_RADIO', // Default to lightweight client to save battery
  encryptionKey: 'TACTICAL_MESH_KEY_01',

  initMesh: (signalingServer) => {
    if (get().meshNode) return;
    const node = new MeshNode('mesh-network', signalingServer, get().encryptionKey);
    
    node.onPeerJsId((id) => set({ peerjsId: id }));
    node.onNodeListChange((list) => set({ metadataList: list }));
    
    set({ meshNode: node });
  },

  destroyMesh: () => {
    const { meshNode } = get();
    if (meshNode) {
      meshNode.destroy();
      set({ meshNode: null, peerjsId: null, metadataList: [] });
    }
  },
  
  connectToPeer: (id) => {
    get().meshNode?.connectToWebRTCPeer(id);
  },

  setNodeRole: (role) => set({ nodeRole: role }),
  setEncryptionKey: (key) => set({ encryptionKey: key }),
}));
