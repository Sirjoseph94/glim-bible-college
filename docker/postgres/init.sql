-- Local roles mirroring production (TRD §5.2): glim_migrator owns the schema, glim_app has DML only.
CREATE ROLE glim_migrator LOGIN PASSWORD 'glim_migrator';
CREATE ROLE glim_app LOGIN PASSWORD 'glim_app';
ALTER DATABASE glim OWNER TO glim_migrator;
\connect glim
ALTER SCHEMA public OWNER TO glim_migrator;
GRANT USAGE ON SCHEMA public TO glim_app;
