-- Runs once, when the postgres volume is first initialised. The image has
-- already created the `dspace` role and database from POSTGRES_USER and
-- POSTGRES_DB; Dataverse gets its own role and database on the same instance.
CREATE ROLE dataverse LOGIN PASSWORD 'secret';
CREATE DATABASE dataverse OWNER dataverse;
