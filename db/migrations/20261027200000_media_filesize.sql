-- The stored file's size in bytes (documents and videos show it; images processed before stay null).
ALTER TABLE media ADD COLUMN filesize INTEGER;
