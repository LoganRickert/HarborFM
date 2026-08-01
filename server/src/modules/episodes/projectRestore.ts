import * as episodeRepo from "./repo.js";
import {
  importProjectZip,
  ImportValidationError,
  type ProjectImportResult,
} from "./projectImport.js";

export { ImportValidationError };

/**
 * Restore an archived episode project zip into the existing episode.
 * Does not overwrite episode metadata (title, description, publish flags, etc.).
 * Processed artifacts are only written when missing locally.
 */
export async function restoreArchivedProjectZip(
  episodeId: string,
  zipPath: string,
  importerUserId: string,
): Promise<ProjectImportResult> {
  const episode = episodeRepo.getById(episodeId);
  if (!episode) {
    throw new ImportValidationError("Episode not found");
  }
  return importProjectZip(episode.podcastId, zipPath, importerUserId, {
    restoreIntoEpisodeId: episodeId,
    skipMetadata: true,
    skipExistingProcessed: true,
    skipShowNotesAndPoll: true,
    skipCast: true,
    skipExistingArtwork: true,
    reuseExistingLibraryAssets: true,
  });
}
