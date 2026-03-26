package com.paradoxon.scrummr.todo

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.jdbc.support.GeneratedKeyHolder
import org.springframework.stereotype.Repository
import java.sql.Statement
import java.time.Instant

@Repository
class TodoRepository(
    private val jdbcTemplate: JdbcTemplate,
) {
    private val todoRowMapper = RowMapper { rs, _ ->
        Todo(
            id = rs.getLong("id"),
            title = rs.getString("title"),
            completed = rs.getBoolean("completed"),
            createdAt = Instant.parse(rs.getString("created_at")),
            updatedAt = Instant.parse(rs.getString("updated_at")),
        )
    }

    fun findAll(): List<Todo> =
        jdbcTemplate.query(
            """
            SELECT id, title, completed, created_at, updated_at
            FROM todos
            ORDER BY created_at DESC, id DESC
            """.trimIndent(),
            todoRowMapper,
        )

    fun findById(id: Long): Todo? =
        jdbcTemplate.query(
            """
            SELECT id, title, completed, created_at, updated_at
            FROM todos
            WHERE id = ?
            """.trimIndent(),
            todoRowMapper,
            id,
        ).firstOrNull()

    fun create(title: String): Todo {
        val now = Instant.now()
        val keyHolder = GeneratedKeyHolder()

        jdbcTemplate.update({ connection ->
            connection.prepareStatement(
                "INSERT INTO todos(title, completed, created_at, updated_at) VALUES (?, ?, ?, ?)",
                Statement.RETURN_GENERATED_KEYS,
            ).apply {
                setString(1, title.trim())
                setBoolean(2, false)
                setString(3, now.toString())
                setString(4, now.toString())
            }
        }, keyHolder)

        val id = keyHolder.key?.toLong()
            ?: throw IllegalStateException("Failed to retrieve generated todo id")

        return findById(id)
            ?: throw IllegalStateException("Todo was created but could not be loaded")
    }

    fun update(id: Long, title: String, completed: Boolean): Todo {
        val updated = jdbcTemplate.update(
            """
            UPDATE todos
            SET title = ?, completed = ?, updated_at = ?
            WHERE id = ?
            """.trimIndent(),
            title.trim(),
            completed,
            Instant.now().toString(),
            id,
        )

        if (updated == 0) {
            throw TodoNotFoundException(id)
        }

        return findById(id) ?: throw TodoNotFoundException(id)
    }

    fun toggle(id: Long): Todo {
        val existing = findById(id) ?: throw TodoNotFoundException(id)
        return update(id, existing.title, !existing.completed)
    }

    fun delete(id: Long) {
        val deleted = jdbcTemplate.update("DELETE FROM todos WHERE id = ?", id)
        if (deleted == 0) {
            throw TodoNotFoundException(id)
        }
    }
}
