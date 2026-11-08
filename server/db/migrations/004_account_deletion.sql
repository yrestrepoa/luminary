-- 004 · Borrado de cuenta (DELETE /api/users/me)
--
-- deleted_at: cuándo se eliminó la cuenta. Solo se rellena cuando la cuenta tiene historial de
--             trades (las FKs de trades → users impiden borrar la fila sin perder el historial de
--             la contraparte): la fila se anonimiza (email, nombre, contraseña y dirección Stellar
--             borrados) y queda marcada. Una cuenta sin trades se borra físicamente.
-- Las sesiones (JWT) y el login ignoran las filas con deleted_at, así que cualquier otra cookie
-- de esa cuenta deja de valer en cuanto se elimina.

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
