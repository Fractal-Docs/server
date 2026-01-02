import pg, { Pool } from "pg"
import { getTableConfig } from "drizzle-orm/pg-core"
import * as schema from "./src/shared/schema"

const DATABASE_URL = process.env.DATABASE_URL

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
  `)

  for (const row of tablesResult.rows) {
    const tableName = row.table_name

    const columnsResult = await pool.query(
      `
      SELECT
        c.column_name,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.column_default,
        CASE
          WHEN pk.column_name IS NOT NULL THEN true
          ELSE false
        END as is_primary_key,
        CASE
          WHEN u.column_name IS NOT NULL THEN true
          ELSE false
        END as is_unique
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT ku.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku
          ON tc.constraint_name = ku.constraint_name
          AND tc.table_schema = ku.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_name = $1
          AND tc.table_schema = 'public'
      ) pk ON c.column_name = pk.column_name
      LEFT JOIN (
        SELECT ku.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku
          ON tc.constraint_name = ku.constraint_name
          AND tc.table_schema = ku.table_schema
        WHERE tc.constraint_type = 'UNIQUE'
          AND tc.table_name = $1
          AND tc.table_schema = 'public'
      ) u ON c.column_name = u.column_name
      WHERE c.table_name = $1
        AND c.table_schema = 'public'
      ORDER BY c.ordinal_position
    `,
      [tableName]
    )

    const columns: Column[] = columnsResult.rows.map((col) => ({
      name: col.column_name,
      type: col.udt_name,
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
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints AS rc
        ON tc.constraint_name = rc.constraint_name
        AND tc.table_schema = rc.constraint_schema
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
        a.attname as column_name,
        ix.indisunique as is_unique
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE t.relkind = 'r'
        AND t.relname = $1
        AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        AND NOT ix.indisprimary
      ORDER BY i.relname, a.attnum
    `,
      [tableName]
    )

    const indexes: Index[] = []
    const indexMap = new Map<string, { columns: string[]; isUnique: boolean }>()
    for (const row of indexResult.rows) {
      if (!indexMap.has(row.index_name)) {
        indexMap.set(row.index_name, { columns: [], isUnique: row.is_unique })
      }
      indexMap.get(row.index_name)!.columns.push(row.column_name)
    }
    for (const [name, { columns, isUnique }] of indexMap) {
      indexes.push({ name, columns, isUnique })
    }

    const pkResult = await pool.query(
      `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_name = $1
        AND tc.table_schema = 'public'
      ORDER BY kcu.ordinal_position
    `,
      [tableName]
    )

    const primaryKeys = pkResult.rows.map((row) => row.column_name)

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

  // Get all exported table definitions from schema.ts
  const tables = [
    { table: schema.prds, name: "prds" },
    { table: schema.githubRepos, name: "github_repos" },
    { table: schema.organizations, name: "organizations" },
    { table: schema.userOrganizations, name: "user_organizations" },
    { table: schema.users, name: "users" },
    { table: schema.repoFiles, name: "repo_files" },
    { table: schema.repoDocs, name: "repo_docs" },
    { table: schema.releases, name: "releases" },
    { table: schema.roles, name: "roles" },
    { table: schema.roleDocs, name: "role_docs" },
    { table: schema.enqueuedTasks, name: "enqueued_tasks" },
    { table: schema.invitations, name: "invitations" },
  ]

  for (const { table, name } of tables) {
    const config = getTableConfig(table)

    const tableSchema: TableSchema = {
      name: config.name,
      columns: [],
      foreignKeys: [],
      indexes: [],
      primaryKeys: [],
    }

    // Extract columns from the table object
    for (const [colName, colDef] of Object.entries(table)) {
      // Skip non-column properties
      if (typeof colDef !== "object" || !colDef || !("name" in colDef)) {
        continue
      }

      const col = colDef as any

      // Determine PostgreSQL type
      let pgType = "text"
      const columnType = col.columnType || ""

      // Serial columns are not nullable in the database
      const isSerialColumn = columnType === "PgSerial"

      if (isSerialColumn) {
        pgType = "int4"
      } else if (columnType === "PgInteger") {
        pgType = "int4"
      } else if (columnType === "PgText") {
        pgType = "text"
      } else if (columnType === "PgBoolean") {
        pgType = "bool"
      } else if (columnType === "PgTimestamp") {
        // Drizzle timestamp with timezone becomes timestamptz in postgres
        pgType = "timestamptz"
      } else if (columnType === "PgJsonb") {
        pgType = "jsonb"
      } else if (columnType === "PgUUID") {
        pgType = "uuid"
      }

      // Determine default value
      let defaultVal: string | null = null
      if (columnType === "PgSerial") {
        defaultVal = "nextval"
      } else if (col.hasDefault) {
        if (col.default !== undefined && col.default !== null) {
          const defaultValue = col.default
          if (typeof defaultValue === "function") {
            const fnStr = defaultValue.toString()
            if (fnStr.includes("now()") || fnStr.includes("CURRENT_TIMESTAMP")) {
              defaultVal = "now()"
            } else if (fnStr.includes("gen_random_uuid") || fnStr.includes("crypto.randomUUID")) {
              defaultVal = "gen_random_uuid()"
            }
          } else if (typeof defaultValue === "boolean") {
            defaultVal = defaultValue.toString()
          } else if (typeof defaultValue === "string") {
            defaultVal = `'${defaultValue}'`
          } else if (typeof defaultValue === "number") {
            defaultVal = defaultValue.toString()
          }
        }
      }

      // Check if column is marked as primary key inline
      const isPrimaryKey = col.primary === true

      // Check if column is unique (from unique constraints or column definition)
      let isUnique = false
      if (config.uniqueConstraints && config.uniqueConstraints.length > 0) {
        isUnique = config.uniqueConstraints.some((uc: any) =>
          uc.columns.length === 1 && uc.columns[0].name === col.name
        )
      }
      if (col.isUnique === true) {
        isUnique = true
      }

      tableSchema.columns.push({
        name: col.name,
        type: pgType,
        nullable: isSerialColumn ? false : !col.notNull,
        default: defaultVal,
        isPrimaryKey,
        isUnique,
      })
    }

    // Extract primary keys from config
    if (config.primaryKeys && config.primaryKeys.length > 0) {
      // Primary keys are stored as an array of PrimaryKey objects
      // Each PrimaryKey object has a columns array
      const pkColumns: string[] = []
      for (const pk of config.primaryKeys) {
        if (pk.columns && Array.isArray(pk.columns)) {
          for (const col of pk.columns) {
            if (col.name) {
              pkColumns.push(col.name)
            }
          }
        }
      }
      tableSchema.primaryKeys = pkColumns

      // Update isPrimaryKey flag for columns that are in the primary key
      for (const col of tableSchema.columns) {
        if (tableSchema.primaryKeys.includes(col.name)) {
          col.isPrimaryKey = true
        }
      }
    }

    // Extract foreign keys
    if (config.foreignKeys && config.foreignKeys.length > 0) {
      for (const fk of config.foreignKeys) {
        const fkConfig = fk as any
        try {
          // Get the reference function result
          const referencedTableFn = fkConfig.reference
          if (typeof referencedTableFn === "function") {
            const refResult = referencedTableFn()

            // The reference returns an object with columns, foreignTable, and foreignColumns
            if (refResult && typeof refResult === "object") {
              const localColumns = refResult.columns || []
              const foreignColumns = refResult.foreignColumns || []
              const foreignTable = refResult.foreignTable

              if (localColumns.length > 0 && foreignColumns.length > 0 && foreignTable) {
                const refTableConfig = getTableConfig(foreignTable)

                tableSchema.foreignKeys.push({
                  columnName: localColumns[0].name,
                  referencedTable: refTableConfig.name,
                  referencedColumn: foreignColumns[0].name,
                  onDelete: fkConfig.onDelete?.toUpperCase() || null,
                })
              }
            }
          }
        } catch (e) {
          // If we can't parse the foreign key, skip it silently
        }
      }
    }

    // Extract indexes
    if (config.indexes && config.indexes.length > 0) {
      for (const idx of config.indexes) {
        const idxConfig = idx.config as any
        if (idxConfig && idxConfig.name && idxConfig.columns) {
          tableSchema.indexes.push({
            name: idxConfig.name,
            columns: idxConfig.columns.map((c: any) => c.name),
            isUnique: idxConfig.unique || false,
          })
        }
      }
    }

    schemas.set(config.name, tableSchema)
  }

  return schemas
}

function compareSchemas(
  actualSchema: Map<string, TableSchema>,
  expectedSchema: Map<string, TableSchema>
) {
  const comparison = {
    missingTables: [] as string[],
    extraTables: [] as string[],
    tableDifferences: new Map<string, any>(),
  }

  const actualTables = new Set(actualSchema.keys())
  const expectedTables = new Set(expectedSchema.keys())

  // Find missing tables
  for (const expectedTable of expectedTables) {
    if (!actualTables.has(expectedTable)) {
      comparison.missingTables.push(expectedTable)
    }
  }

  // Find extra tables
  for (const actualTable of actualTables) {
    if (!expectedTables.has(actualTable)) {
      comparison.extraTables.push(actualTable)
    }
  }

  // Compare tables that exist in both
  for (const tableName of expectedTables) {
    if (!actualTables.has(tableName)) continue

    const actualTable = actualSchema.get(tableName)!
    const expectedTable = expectedSchema.get(tableName)!

    const tableDiff = {
      name: tableName,
      missingColumns: [] as any[],
      extraColumns: [] as string[],
      columnDifferences: [] as any[],
      missingForeignKeys: [] as any[],
      extraForeignKeys: [] as any[],
      missingIndexes: [] as any[],
      extraIndexes: [] as any[],
    }

    const actualColumns = new Map(actualTable.columns.map((c) => [c.name, c]))
    const expectedColumns = new Map(expectedTable.columns.map((c) => [c.name, c]))

    // Check for missing columns
    for (const [colName, expectedCol] of expectedColumns) {
      if (!actualColumns.has(colName)) {
        tableDiff.missingColumns.push(expectedCol)
      }
    }

    // Check for extra columns and differences
    for (const [colName, actualCol] of actualColumns) {
      if (!expectedColumns.has(colName)) {
        tableDiff.extraColumns.push(colName)
      } else {
        const expectedCol = expectedColumns.get(colName)!
        if (actualCol.type !== expectedCol.type) {
          tableDiff.columnDifferences.push({
            column: colName,
            issue: "type mismatch",
            expected: expectedCol.type,
            actual: actualCol.type,
          })
        }
        if (actualCol.nullable !== expectedCol.nullable) {
          tableDiff.columnDifferences.push({
            column: colName,
            issue: "nullable mismatch",
            expected: expectedCol.nullable,
            actual: actualCol.nullable,
          })
        }
        if (actualCol.isPrimaryKey !== expectedCol.isPrimaryKey) {
          tableDiff.columnDifferences.push({
            column: colName,
            issue: "primary key mismatch",
            expected: expectedCol.isPrimaryKey,
            actual: actualCol.isPrimaryKey,
          })
        }
        if (actualCol.isUnique !== expectedCol.isUnique) {
          tableDiff.columnDifferences.push({
            column: colName,
            issue: "unique constraint mismatch",
            expected: expectedCol.isUnique,
            actual: actualCol.isUnique,
          })
        }
      }
    }

    // Compare foreign keys
    const actualFks = actualTable.foreignKeys.map(
      (fk) => `${fk.columnName}->${fk.referencedTable}.${fk.referencedColumn}`
    )
    const expectedFks = expectedTable.foreignKeys.map(
      (fk) => `${fk.columnName}->${fk.referencedTable}.${fk.referencedColumn}`
    )

    for (const fk of expectedTable.foreignKeys) {
      const fkKey = `${fk.columnName}->${fk.referencedTable}.${fk.referencedColumn}`
      if (!actualFks.includes(fkKey)) {
        tableDiff.missingForeignKeys.push(fk)
      }
    }

    for (const fk of actualTable.foreignKeys) {
      const fkKey = `${fk.columnName}->${fk.referencedTable}.${fk.referencedColumn}`
      if (!expectedFks.includes(fkKey)) {
        tableDiff.extraForeignKeys.push(fk)
      }
    }

    // Compare indexes
    const actualIndexNames = new Set(actualTable.indexes.map((i) => i.name))
    const expectedIndexNames = new Set(expectedTable.indexes.map((i) => i.name))

    for (const idx of expectedTable.indexes) {
      if (!actualIndexNames.has(idx.name)) {
        tableDiff.missingIndexes.push(idx)
      }
    }

    for (const idx of actualTable.indexes) {
      if (!expectedIndexNames.has(idx.name)) {
        tableDiff.extraIndexes.push(idx)
      }
    }

    // Only add to differences if there are actual differences
    if (
      tableDiff.missingColumns.length > 0 ||
      tableDiff.extraColumns.length > 0 ||
      tableDiff.columnDifferences.length > 0 ||
      tableDiff.missingForeignKeys.length > 0 ||
      tableDiff.extraForeignKeys.length > 0 ||
      tableDiff.missingIndexes.length > 0 ||
      tableDiff.extraIndexes.length > 0
    ) {
      comparison.tableDifferences.set(tableName, tableDiff)
    }
  }

  return comparison
}

function printComparison(comparison: ReturnType<typeof compareSchemas>) {
  console.log("\n=== Database Schema Comparison ===\n")

  if (comparison.missingTables.length > 0) {
    console.log("❌ Missing tables (in schema.ts but not in database):")
    comparison.missingTables.forEach((table) => console.log(`  - ${table}`))
    console.log()
  }

  if (comparison.extraTables.length > 0) {
    console.log("⚠️  Extra tables (in database but not in schema.ts):")
    comparison.extraTables.forEach((table) => console.log(`  - ${table}`))
    console.log()
  }

  if (comparison.tableDifferences.size > 0) {
    console.log("📊 Table differences:\n")
    for (const [tableName, diff] of comparison.tableDifferences) {
      console.log(`Table: ${tableName}`)

      if (diff.missingColumns.length > 0) {
        console.log("  ❌ Missing columns:")
        diff.missingColumns.forEach((col: Column) =>
          console.log(`    - ${col.name} (${col.type})`)
        )
      }

      if (diff.extraColumns.length > 0) {
        console.log("  ⚠️  Extra columns:")
        diff.extraColumns.forEach((col: string) => console.log(`    - ${col}`))
      }

      if (diff.columnDifferences.length > 0) {
        console.log("  🔄 Column differences:")
        diff.columnDifferences.forEach((d: any) =>
          console.log(
            `    - ${d.column}: ${d.issue} (expected: ${d.expected}, actual: ${d.actual})`
          )
        )
      }

      if (diff.missingForeignKeys.length > 0) {
        console.log("  ❌ Missing foreign keys:")
        diff.missingForeignKeys.forEach((fk: ForeignKey) =>
          console.log(
            `    - ${fk.columnName} -> ${fk.referencedTable}.${fk.referencedColumn}`
          )
        )
      }

      if (diff.extraForeignKeys.length > 0) {
        console.log("  ⚠️  Extra foreign keys:")
        diff.extraForeignKeys.forEach((fk: ForeignKey) =>
          console.log(
            `    - ${fk.columnName} -> ${fk.referencedTable}.${fk.referencedColumn}`
          )
        )
      }

      if (diff.missingIndexes.length > 0) {
        console.log("  ❌ Missing indexes:")
        diff.missingIndexes.forEach((idx: Index) =>
          console.log(`    - ${idx.name} on [${idx.columns.join(", ")}]`)
        )
      }

      if (diff.extraIndexes.length > 0) {
        console.log("  ⚠️  Extra indexes:")
        diff.extraIndexes.forEach((idx: Index) =>
          console.log(`    - ${idx.name} on [${idx.columns.join(", ")}]`)
        )
      }

      console.log()
    }
  }

  const hasIssues =
    comparison.missingTables.length > 0 ||
    comparison.extraTables.length > 0 ||
    comparison.tableDifferences.size > 0

  if (!hasIssues) {
    console.log("✅ Database schema matches expected schema perfectly!\n")
  }

  return hasIssues
}

async function main() {
  if (!DATABASE_URL) {
    console.error("❌ DATABASE_URL environment variable is not set")
    process.exit(1)
  }

  console.log("Connecting to database...")

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  })

  try {
    // Test connection
    await pool.query("SELECT NOW()")
    console.log("✅ Connected to database\n")

    console.log("Fetching actual database schema...")
    const actualSchema = await getDatabaseSchema(pool)
    console.log(`✅ Found ${actualSchema.size} tables in database\n`)

    console.log("Generating expected schema from schema.ts...")
    const expectedSchema = getExpectedSchema()
    console.log(`✅ Found ${expectedSchema.size} tables in schema.ts\n`)

    const comparison = compareSchemas(actualSchema, expectedSchema)

    const hasIssues = printComparison(comparison)

    await pool.end()
    process.exit(hasIssues ? 1 : 0)
  } catch (error) {
    console.error("❌ Error:", error)
    await pool.end()
    process.exit(1)
  }
}

main()
