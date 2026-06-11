/**
 * Pixieset [H] — gallery delivery, the demo workflow for real (SPEC §4.3).
 * Read-only: collections, galleries, download activity → delivery-latency
 * scans (shoot → gallery → delivery email).
 */
import { HttpConnectorClient } from './base';
import type { Connection } from '../types';
import type { TokenVault } from '../vault';
import type { UnsafeTestOverrides } from '../egress/safe-fetch';

const BASE = 'https://api.pixieset.com';

export interface PixiesetCollection {
  id: string;
  name?: string;
  created_at?: string;
  published_at?: string;
  client_email?: string;
}

export class PixiesetClient extends HttpConnectorClient {
  constructor(connection: Connection, vault: TokenVault, unsafeTestOverrides?: UnsafeTestOverrides) {
    super(connection, BASE, vault, unsafeTestOverrides);
  }

  async listCollections(page = 1): Promise<{ data?: PixiesetCollection[] }> {
    const { data } = await this.readJson<{ data?: PixiesetCollection[] }>(`/v1/collections?page=${page}`);
    return data;
  }

  async getCollection(id: string): Promise<PixiesetCollection> {
    const { data } = await this.readJson<PixiesetCollection>(`/v1/collections/${encodeURIComponent(id)}`);
    return data;
  }

  async listDownloads(collectionId: string): Promise<{ data?: Array<{ id: string; downloaded_at?: string }> }> {
    const { data } = await this.readJson<{ data?: Array<{ id: string; downloaded_at?: string }> }>(
      `/v1/collections/${encodeURIComponent(collectionId)}/downloads`,
    );
    return data;
  }
}
