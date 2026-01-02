import pg from "pg"

const { Pool } = pg

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres.aiwklhzehnzyuvbyezvq:Kss343sZYurZUzjR6RZc@aws-0-ca-central-1.pooler.supabase.com:6543/postgres"

interface Column {
  name: string
  type: string
  nullable: boolean
  default: string | null
  isPrimaryKey: boolean
  isUnique: boolean
}

interface ForeignKey {
  columnName: string
  referencedTable: string
  referencedColumn: string
  onDelete: string | null
}

interface Index {
  name: string
  columns: string[]
  isUnique: boolean
}

interface TableSchema {
  name: string
  columns: Column[]
  foreignKeys: ForeignKey[]
  indexes: Index[]
  primaryKeys: string[]
}

async function getDatabaseSchema(pool: Pool): Promise<Map<string, TableSchema>> {
  const schemas = new Map<string, TableSchema>()

  const tablesResult = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `)

  for (const row of tablesResult.rows) {
    const tableName = row.table_name as string

    const columnsResult = await pool.query(
      `
      SELECT
        c.column_name,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.column_default,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
        CASE WHEN u.column_name IS NOT NULL THEN true ELSE false END as is_unique
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT ku.column_name, ku.table_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku
          ON tc.constraint_name = ku.constraint_name
          AND tc.table_schema = ku.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public'
      ) pk ON c.column_name = pk.column_name AND c.table_name = pk.table_name
      LEFT JOIN (
        SELECT ku.column_name, ku.table_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku
          ON tc.constraint_name = ku.constraint_name
          AND tc.table_schema = ku.table_schema
        WHERE tc.constraint_type = 'UNIQUE'
          AND tc.table_schema = 'public'
      ) u ON c.column_name = u.column_name AND c.table_name = u.table_name
      WHERE c.table_name = $1
        AND c.table_schema = 'public'
      ORDER BY c.ordinal_position
    `,
      [tableName]
    )

    const columns: Column[] = columnsResult.rows.map((col) => ({
      name: col.column_name,
      type: col.udt_name || col.data_type,
      nullable: col.is_nullable === "YES",
      default: col.column_default,
      isPrimaryKey: col.is_primary_key,
      isUnique: col.is_unique,
    }))

    const fkResult = await pool.query(
      `
      SELECT
        kcu.column_name,
        ccu.table_name AS referenced_table,
        ccu.column_name AS referenced_column,
        rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = $1
        AND tc.table_schema = 'public'
    `,
      [tableName]
    )

    const foreignKeys: ForeignKey[] = fkResult.rows.map((fk) => ({
      columnName: fk.column_name,
      referencedTable: fk.referenced_table,
      referencedColumn: fk.referenced_column,
      onDelete: fk.delete_rule,
    }))

    const indexResult = await pool.query(
      `
      SELECT
        i.relname as index_name,
        array_agg(a.attname ORDER BY a.attnum) as columns,
        ix.indisunique as is_unique
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE t.relname = $1
        AND t.relkind = 'r'
        AND i.relname NOT LIKE '%_pkey'
      GROUP BY i.relname, ix.indisunique
    `,
      [tableName]
    )

    const indexes: Index[] = indexResult.rows.map((idx) => ({
      name: idx.index_name,
      columns: idx.columns,
      isUnique: idx.is_unique,
    }))

    const pkResult = await pool.query(
      `
      SELECT ku.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage ku
        ON tc.constraint_name = ku.constraint_name
        AND tc.table_schema = ku.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_name = $1
        AND tc.table_schema = 'public'
      ORDER BY ku.ordinal_position
    `,
      [tableName]
    )

    const primaryKeys = pkResult.rows.map((pk) => pk.column_name)

    schemas.set(tableName, {
      name: tableName,
      columns,
      foreignKeys,
      indexes,
      primaryKeys,
    })
  }

  return schemas
}

function getExpectedSchema(): Map<string, TableSchema> {
  const schemas = new Map<string, TableSchema>()

  // Based on src/shared/schema.ts Drizzle definitions
  schemas.set("prds", {
    name: "prds",
    columns: [
      { name: "id", type: "int4", nullable: false, default: "nextval", isPrimaryKey: true, isUnique: false },
      { name: "public_id", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: true },
      { name: "title", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "content", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "business_context", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "repo_public_id", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "branch", type: "text", nullable: true, default: null, isPrimaryKey: false, isUnique: false },
    ],
    foreignKeys: [
      { columnName: "repo_public_id", referencedTable: "github_repos", referencedColumn: "public_id", onDelete: "CASCADE" },
    ],
    indexes: [],
    primaryKeys: ["id"],
  })

  schemas.set("github_repos", {
    name: "github_repos",
    columns: [
      { name: "id", type: "int4", nullable: false, default: "nextval", isPrimaryKey: true, isUnique: false },
      { name: "public_id", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: true },
      { name: "name", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "full_name", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "owner", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "repo_id", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "organization_id", type: "int4", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "file_filter_regex", type: "text", nullable: true, default: null, isPrimaryKey: false, isUnique: false },
      { name: "created_at", type: "timestamp", nullable: false, default: "now()", isPrimaryKey: false, isUnique: false },
    ],
    foreignKeys: [
      { columnName: "organization_id", referencedTable: "organizations", referencedColumn: "id", onDelete: "CASCADE" },
    ],
    indexes: [],
    primaryKeys: ["id"],
  })

  schemas.set("organizations", {
    name: "organizations",
    columns: [
      { name: "id", type: "int4", nullable: false, default: "nextval", isPrimaryKey: true, isUnique: false },
      { name: "public_id", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: true },
      { name: "name", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "description", type: "text", nullable: true, default: null, isPrimaryKey: false, isUnique: false },
      { name: "is_personal", type: "bool", nullable: false, default: "true", isPrimaryKey: false, isUnique: false },
      { name: "slug", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: true },
      { name: "profile_image_url", type: "text", nullable: true, default: null, isPrimaryKey: false, isUnique: false },
      { name: "installation_id", type: "int4", nullable: true, default: null, isPrimaryKey: false, isUnique: false },
      { name: "access_token", type: "text", nullable: true, default: null, isPrimaryKey: false, isUnique: false },
      { name: "created_at", type: "timestamp", nullable: false, default: "now()", isPrimaryKey: false, isUnique: false },
      { name: "updated_at", type: "timestamp", nullable: false, default: "now()", isPrimaryKey: false, isUnique: false },
    ],
    foreignKeys: [],
    indexes: [],
    primaryKeys: ["id"],
  })

  schemas.set("user_organizations", {
    name: "user_organizations",
    columns: [
      { name: "user_id", type: "int4", nullable: false, default: null, isPrimaryKey: true, isUnique: false },
      { name: "organization_id", type: "int4", nullable: false, default: null, isPrimaryKey: true, isUnique: false },
      { name: "role", type: "text", nullable: false, default: "'member'", isPrimaryKey: false, isUnique: false },
      { name: "created_at", type: "timestamp", nullable: false, default: "now()", isPrimaryKey: false, isUnique: false },
    ],
    foreignKeys: [
      { columnName: "user_id", referencedTable: "users", referencedColumn: "id", onDelete: "CASCADE" },
      { columnName: "organization_id", referencedTable: "organizations", referencedColumn: "id", onDelete: "CASCADE" },
    ],
    indexes: [],
    primaryKeys: ["user_id", "organization_id"],
  })

  schemas.set("users", {
    name: "users",
    columns: [
      { name: "id", type: "int4", nullable: false, default: "nextval", isPrimaryKey: true, isUnique: false },
      { name: "public_id", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: true },
      { name: "user_sub", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: true },
      { name: "name", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "email", type: "text", nullable: true, default: null, isPrimaryKey: false, isUnique: false },
      { name: "theme_preferences", type: "jsonb", nullable: true, default: null, isPrimaryKey: false, isUnique: false },
    ],
    foreignKeys: [],
    indexes: [],
    primaryKeys: ["id"],
  })

  schemas.set("repo_files", {
    name: "repo_files",
    columns: [
      { name: "id", type: "int4", nullable: false, default: "nextval", isPrimaryKey: false, isUnique: false },
      { name: "repo_public_id", type: "text", nullable: false, default: null, isPrimaryKey: true, isUnique: false },
      { name: "file_path", type: "text", nullable: false, default: null, isPrimaryKey: true, isUnique: false },
      { name: "branch", type: "text", nullable: false, default: null, isPrimaryKey: true, isUnique: false },
      { name: "content", type: "text", nullable: true, default: null, isPrimaryKey: false, isUnique: false },
      { name: "metadata", type: "jsonb", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "created_at", type: "timestamp", nullable: false, default: "now()", isPrimaryKey: false, isUnique: false },
      { name: "updated_at", type: "timestamp", nullable: false, default: "now()", isPrimaryKey: false, isUnique: false },
    ],
    foreignKeys: [
      { columnName: "repo_public_id", referencedTable: "github_repos", referencedColumn: "public_id", onDelete: "CASCADE" },
    ],
    indexes: [],
    primaryKeys: ["repo_public_id", "file_path", "branch"],
  })

  schemas.set("repo_docs", {
    name: "repo_docs",
    columns: [
      { name: "id", type: "int4", nullable: false, default: "nextval", isPrimaryKey: false, isUnique: false },
      { name: "repo_public_id", type: "text", nullable: false, default: null, isPrimaryKey: true, isUnique: false },
      { name: "title", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "content", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "doc_type", type: "text", nullable: false, default: null, isPrimaryKey: true, isUnique: false },
      { name: "branch", type: "text", nullable: false, default: null, isPrimaryKey: true, isUnique: false },
      { name: "metadata", type: "jsonb", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "created_at", type: "timestamp", nullable: false, default: "now()", isPrimaryKey: false, isUnique: false },
      { name: "updated_at", type: "timestamp", nullable: false, default: "now()", isPrimaryKey: false, isUnique: false },
    ],
    foreignKeys: [
      { columnName: "repo_public_id", referencedTable: "github_repos", referencedColumn: "public_id", onDelete: "CASCADE" },
    ],
    indexes: [],
    primaryKeys: ["repo_public_id", "doc_type", "branch"],
  })

  schemas.set("releases", {
    name: "releases",
    columns: [
      { name: "id", type: "int4", nullable: false, default: "nextval", isPrimaryKey: true, isUnique: false },
      { name: "public_id", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: true },
      { name: "title", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "repo_public_id", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "branch", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "content", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "created_at", type: "timestamp", nullable: false, default: "now()", isPrimaryKey: false, isUnique: false },
      { name: "updated_at", type: "timestamp", nullable: false, default: "now()", isPrimaryKey: false, isUnique: false },
    ],
    foreignKeys: [
      { columnName: "repo_public_id", referencedTable: "github_repos", referencedColumn: "public_id", onDelete: "CASCADE" },
    ],
    indexes: [],
    primaryKeys: ["id"],
  })

  schemas.set("roles", {
    name: "roles",
    columns: [
      { name: "id", type: "int4", nullable: false, default: "nextval", isPrimaryKey: true, isUnique: false },
      { name: "public_id", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: true },
      { name: "organization_id", type: "int4", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "role_type", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "context", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "created_at", type: "timestamp", nullable: false, default: "now()", isPrimaryKey: false, isUnique: false },
      { name: "updated_at", type: "timestamp", nullable: false, default: "now()", isPrimaryKey: false, isUnique: false },
    ],
    foreignKeys: [
      { columnName: "organization_id", referencedTable: "organizations", referencedColumn: "id", onDelete: "CASCADE" },
    ],
    indexes: [],
    primaryKeys: ["id"],
  })

  schemas.set("role_docs", {
    name: "role_docs",
    columns: [
      { name: "release_public_id", type: "text", nullable: false, default: null, isPrimaryKey: true, isUnique: false },
      { name: "repo_public_id", type: "text", nullable: false, default: null, isPrimaryKey: true, isUnique: false },
      { name: "role_public_id", type: "text", nullable: false, default: null, isPrimaryKey: true, isUnique: false },
      { name: "doc", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "created_at", type: "timestamp", nullable: false, default: "now()", isPrimaryKey: false, isUnique: false },
    ],
    foreignKeys: [
      { columnName: "repo_public_id", referencedTable: "github_repos", referencedColumn: "public_id", onDelete: "CASCADE" },
    ],
    indexes: [],
    primaryKeys: ["release_public_id", "repo_public_id", "role_public_id"],
  })

  schemas.set("enqueued_tasks", {
    name: "enqueued_tasks",
    columns: [
      { name: "job_id", type: "text", nullable: false, default: null, isPrimaryKey: true, isUnique: false },
      { name: "branch", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "repo_public_id", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "organization_id", type: "int4", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "type", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "status", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "message", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "details", type: "jsonb", nullable: true, default: null, isPrimaryKey: false, isUnique: false },
      { name: "updated_at", type: "timestamp", nullable: false, default: "now()", isPrimaryKey: false, isUnique: false },
      { name: "created_at", type: "timestamp", nullable: false, default: "now()", isPrimaryKey: false, isUnique: false },
    ],
    foreignKeys: [
      { columnName: "repo_public_id", referencedTable: "github_repos", referencedColumn: "public_id", onDelete: "CASCADE" },
      { columnName: "organization_id", referencedTable: "organizations", referencedColumn: "id", onDelete: "NO ACTION" },
    ],
    indexes: [],
    primaryKeys: ["job_id"],
  })

  schemas.set("invitations", {
    name: "invitations",
    columns: [
      { name: "organization_id", type: "int4", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "email", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "token", type: "uuid", nullable: false, default: "gen_random_uuid()", isPrimaryKey: true, isUnique: false },
      { name: "status", type: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: false },
      { name: "created_at", type: "timestamp", nullable: false, default: "now()", isPrimaryKey: false, isUnique: false },
      { name: "updated_at", type: "timestamp", nullable: false, default: "now()", isPrimaryKey: false, isUnique: false },
    ],
    foreignKeys: [
      { columnName: "organization_id", referencedTable: "organizations", referencedColumn: "id", onDelete: "CASCADE" },
    ],
    indexes: [
      { name: "invitations_email_idx", columns: ["email"], isUnique: false },
    ],
    primaryKeys: ["token"],
  })

  return schemas
}

function compareSchemas(actual: Map<string, TableSchema>, expected: Map<string, TableSchema>) {
  const comparison = {
    missingTables: [] as string[],
    extraTables: [] as string[],
    tableDifferences: [] as any[],
  }

  const actualTables = new Set(actual.keys())
  const expectedTables = new Set(expected.keys())

  for (const table of expectedTables) {
    if (!actualTables.has(table)) {
      comparison.missingTables.push(table)
    }
  }

  for (const table of actualTables) {
    if (!expectedTables.has(table)) {
      comparison.extraTables.push(table)
    }
  }

  for (const tableName of expectedTables) {
    if (!actualTables.has(tableName)) continue

    const actualTable = actual.get(tableName)!
    const expectedTable = expected.get(tableName)!

    const tableDiff: any = {
      tableName,
      missingColumns: [],
      extraColumns: [],
      columnDifferences: [],
      missingForeignKeys: [],
      extraForeignKeys: [],
      missingIndexes: [],
      extraIndexes: [],
    }

    const actualColumns = new Map(actualTable.columns.map((c) => [c.name, c]))
    const expectedColumns = new Map(expectedTable.columns.map((c) => [c.name, c]))

    for (const [colName, expectedCol] of expectedColumns) {
      if (!actualColumns.has(colName)) {
        tableDiff.missingColumns.push(colName)
        continue
      }

      const actualCol = actualColumns.get(colName)!

      if (actualCol.type !== expectedCol.type) {
        tableDiff.columnDifferences.push({
          column: colName,
          issue: "Type mismatch",
          expected: expectedCol.type,
          actual: actualCol.type,
        })
      }

      if (actualCol.nullable !== expectedCol.nullable) {
        tableDiff.columnDifferences.push({
          column: colName,
          issue: "Nullable mismatch",
          expected: expectedCol.nullable ? "nullable" : "not null",
          actual: actualCol.nullable ? "nullable" : "not null",
        })
      }

      if (actualCol.isPrimaryKey !== expectedCol.isPrimaryKey) {
        tableDiff.columnDifferences.push({
          column: colName,
          issue: "Primary key mismatch",
          expected: expectedCol.isPrimaryKey ? "is primary key" : "not primary key",
          actual: actualCol.isPrimaryKey ? "is primary key" : "not primary key",
        })
      }

      if (actualCol.isUnique !== expectedCol.isUnique) {
        tableDiff.columnDifferences.push({
          column: colName,
          issue: "Unique constraint mismatch",
          expected: expectedCol.isUnique ? "unique" : "not unique",
          actual: actualCol.isUnique ? "unique" : "not unique",
        })
      }
    }

    for (const colName of actualColumns.keys()) {
      if (!expectedColumns.has(colName)) {
        tableDiff.extraColumns.push(colName)
      }
    }

    const actualFks = actualTable.foreignKeys.map(
      (fk) => `${fk.columnName} -> ${fk.referencedTable}(${fk.referencedColumn})`
    )
    const expectedFks = expectedTable.foreignKeys.map(
      (fk) => `${fk.columnName} -> ${fk.referencedTable}(${fk.referencedColumn})`
    )

    for (const fk of expectedFks) {
      if (!actualFks.includes(fk)) {
        tableDiff.missingForeignKeys.push(fk)
      }
    }

    for (const fk of actualFks) {
      if (!expectedFks.includes(fk)) {
        tableDiff.extraForeignKeys.push(fk)
      }
    }

    const actualIndexNames = actualTable.indexes.map((idx) => idx.name)
    const expectedIndexNames = expectedTable.indexes.map((idx) => idx.name)

    for (const idx of expectedIndexNames) {
      if (!actualIndexNames.includes(idx)) {
        tableDiff.missingIndexes.push(idx)
      }
    }

    for (const idx of actualIndexNames) {
      if (!expectedIndexNames.includes(idx)) {
        tableDiff.extraIndexes.push(idx)
      }
    }

    if (
      tableDiff.missingColumns.length > 0 ||
      tableDiff.extraColumns.length > 0 ||
      tableDiff.columnDifferences.length > 0 ||
      tableDiff.missingForeignKeys.length > 0 ||
      tableDiff.extraForeignKeys.length > 0 ||
      tableDiff.missingIndexes.length > 0 ||
      tableDiff.extraIndexes.length > 0
    ) {
      comparison.tableDifferences.push(tableDiff)
    }
  }

  return comparison
}

function printComparison(comparison: any) {
  console.log("\n" + "=".repeat(80))
  console.log("DATABASE SCHEMA COMPARISON REPORT")
  console.log("=".repeat(80) + "\n")

  let hasIssues = false

  if (comparison.missingTables.length > 0) {
    hasIssues = true
    console.log("❌ MISSING TABLES (defined in schema but not in database):")
    for (const table of comparison.missingTables) {
      console.log(`   - ${table}`)
    }
    console.log()
  }

  if (comparison.extraTables.length > 0) {
    hasIssues = true
    console.log("⚠️  EXTRA TABLES (in database but not in schema):")
    for (const table of comparison.extraTables) {
      console.log(`   - ${table}`)
    }
    console.log()
  }

  if (comparison.tableDifferences.length > 0) {
    hasIssues = true
    console.log("🔍 TABLE DIFFERENCES:\n")

    for (const diff of comparison.tableDifferences) {
      console.log(`Table: ${diff.tableName}`)
      console.log("-".repeat(80))

      if (diff.missingColumns.length > 0) {
        console.log("  ❌ Missing columns:")
        for (const col of diff.missingColumns) {
          console.log(`     - ${col}`)
        }
      }

      if (diff.extraColumns.length > 0) {
        console.log("  ⚠️  Extra columns:")
        for (const col of diff.extraColumns) {
          console.log(`     - ${col}`)
        }
      }

      if (diff.columnDifferences.length > 0) {
        console.log("  ⚠️  Column differences:")
        for (const colDiff of diff.columnDifferences) {
          console.log(`     - ${colDiff.column}: ${colDiff.issue}`)
          console.log(`       Expected: ${colDiff.expected}`)
          console.log(`       Actual: ${colDiff.actual}`)
        }
      }

      if (diff.missingForeignKeys.length > 0) {
        console.log("  ❌ Missing foreign keys:")
        for (const fk of diff.missingForeignKeys) {
          console.log(`     - ${fk}`)
        }
      }

      if (diff.extraForeignKeys.length > 0) {
        console.log("  ⚠️  Extra foreign keys:")
        for (const fk of diff.extraForeignKeys) {
          console.log(`     - ${fk}`)
        }
      }

      if (diff.missingIndexes.length > 0) {
        console.log("  ❌ Missing indexes:")
        for (const idx of diff.missingIndexes) {
          console.log(`     - ${idx}`)
        }
      }

      if (diff.extraIndexes.length > 0) {
        console.log("  ⚠️  Extra indexes:")
        for (const idx of diff.extraIndexes) {
          console.log(`     - ${idx}`)
        }
      }

      console.log()
    }
  }

  if (!hasIssues) {
    console.log("✅ NO INCONSISTENCIES FOUND!")
    console.log("   Database schema matches the Drizzle schema definition.")
  }

  console.log("=".repeat(80))
  console.log()
}

async function main() {
  console.log("Connecting to database...")
  console.log(`Database URL: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`)
  console.log()

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : {
      rejectUnauthorized: false,
    },
  })

  try {
    await pool.query("SELECT NOW()")
    console.log("✅ Connected successfully!\n")

    console.log("Extracting database schema...")
    const actualSchema = await getDatabaseSchema(pool)
    console.log(`✅ Found ${actualSchema.size} tables in database\n`)

    console.log("Loading expected schema from Drizzle definition...")
    const expectedSchema = getExpectedSchema()
    console.log(`✅ Loaded ${expectedSchema.size} tables from schema definition\n`)

    console.log("Comparing schemas...")
    const comparison = compareSchemas(actualSchema, expectedSchema)

    printComparison(comparison)

    const hasIssues =
      comparison.missingTables.length > 0 ||
      comparison.extraTables.length > 0 ||
      comparison.tableDifferences.length > 0

    process.exit(hasIssues ? 1 : 0)
  } catch (error) {
    console.error("❌ Error:", error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main()
