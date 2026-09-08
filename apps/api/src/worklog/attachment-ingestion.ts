/**
 * Temporary source-compatibility aliases for the target AI media provider contract.
 *
 * The former LINE quoted-attachment ingestion runtime was retired and physically removed.
 * New code should import the AiMedia* names from ./ai-media-capture directly.
 */
export type {
  AiMediaInputType as WorklogAttachmentInputType,
  AiMediaProvider as WorklogAttachmentProvider,
  AiMediaProviderOutput as WorklogAttachmentOutput,
  AiMediaProviderResponse as WorklogAttachmentProviderResponse,
} from './ai-media-capture';
