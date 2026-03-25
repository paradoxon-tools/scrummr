package com.paradoxon.scrummr.todo;

import java.time.Instant;

public record Todo(
        long id,
        String title,
        boolean completed,
        Instant createdAt,
        Instant updatedAt
) {
}
