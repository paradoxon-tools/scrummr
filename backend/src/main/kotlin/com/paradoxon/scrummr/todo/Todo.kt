package com.paradoxon.scrummr.todo

import java.time.Instant

data class Todo(
    val id: Long,
    val title: String,
    val completed: Boolean,
    val createdAt: Instant,
    val updatedAt: Instant,
)
