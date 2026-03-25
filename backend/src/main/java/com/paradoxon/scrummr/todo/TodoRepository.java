package com.paradoxon.scrummr.todo;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Repository
public class TodoRepository {

    private static final RowMapper<Todo> TODO_ROW_MAPPER = (rs, rowNum) -> new Todo(
            rs.getLong("id"),
            rs.getString("title"),
            rs.getBoolean("completed"),
            Instant.parse(rs.getString("created_at")),
            Instant.parse(rs.getString("updated_at"))
    );

    private final JdbcTemplate jdbcTemplate;

    public TodoRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<Todo> findAll() {
        return jdbcTemplate.query("""
                SELECT id, title, completed, created_at, updated_at
                FROM todos
                ORDER BY created_at DESC, id DESC
                """, TODO_ROW_MAPPER);
    }

    public Optional<Todo> findById(long id) {
        List<Todo> todos = jdbcTemplate.query("""
                SELECT id, title, completed, created_at, updated_at
                FROM todos
                WHERE id = ?
                """, TODO_ROW_MAPPER, id);
        return todos.stream().findFirst();
    }

    public Todo create(String title) {
        Instant now = Instant.now();
        KeyHolder keyHolder = new GeneratedKeyHolder();

        jdbcTemplate.update(connection -> {
            PreparedStatement statement = connection.prepareStatement(
                    "INSERT INTO todos(title, completed, created_at, updated_at) VALUES (?, ?, ?, ?)",
                    Statement.RETURN_GENERATED_KEYS
            );
            statement.setString(1, title.trim());
            statement.setBoolean(2, false);
            statement.setString(3, now.toString());
            statement.setString(4, now.toString());
            return statement;
        }, keyHolder);

        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("Failed to retrieve generated todo id");
        }

        return findById(key.longValue())
                .orElseThrow(() -> new IllegalStateException("Todo was created but could not be loaded"));
    }

    public Todo update(long id, String title, boolean completed) {
        int updated = jdbcTemplate.update("""
                UPDATE todos
                SET title = ?, completed = ?, updated_at = ?
                WHERE id = ?
                """, title.trim(), completed, Instant.now().toString(), id);

        if (updated == 0) {
            throw new TodoNotFoundException(id);
        }

        return findById(id).orElseThrow(() -> new TodoNotFoundException(id));
    }

    public Todo toggle(long id) {
        Todo existing = findById(id).orElseThrow(() -> new TodoNotFoundException(id));
        return update(id, existing.title(), !existing.completed());
    }

    public void delete(long id) {
        int deleted = jdbcTemplate.update("DELETE FROM todos WHERE id = ?", id);
        if (deleted == 0) {
            throw new TodoNotFoundException(id);
        }
    }
}
