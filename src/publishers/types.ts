export type CMSPlatform = 'wordpress' | 'webflow' | 'shopify' | 'webhook';

export interface WordPressConfig {
  platform: 'wordpress';
  siteUrl: string; // Ex: "https://meublog.com.br"
  username: string; // Usuário do WP
  applicationPassword: string; // Senha de aplicativo nativa do WordPress (sem espaços)
  defaultStatus?: 'publish' | 'draft';
  authorId?: number;
  categories?: number[];
  tags?: number[];
}

export interface WebflowConfig {
  platform: 'webflow';
  apiToken: string;
  collectionId: string;
  isDraft?: boolean;
}

export interface WebhookConfig {
  platform: 'webhook';
  endpointUrl: string;
  secretKey?: string;
  customHeaders?: Record<string, string>;
}

export type CMSConfig = WordPressConfig | WebflowConfig | WebhookConfig;

export interface PublishResult {
  success: boolean;
  platform: CMSPlatform;
  publishedUrl?: string;
  remoteId?: string | number;
  status: 'published' | 'draft';
  error?: string;
  indexNowNotified?: boolean;
}

export interface IndexNowConfig {
  host: string; // Ex: "meublog.com.br"
  key: string; // Chave de verificação IndexNow (hexadecimal de 32 caracteres)
  keyLocation?: string; // Opcional: URL onde o arquivo .txt com a chave está hospedado
}
