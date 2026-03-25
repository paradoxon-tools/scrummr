package com.paradoxon.scrummr.todo

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

data class UpdateTodoRequest(
    @field:NotBlank(message = "Title is required")
    @field:Size(max = 255, message = "Title must be 255 characters or fewer")
    val title: String,
    val completed: Boolean,
)
