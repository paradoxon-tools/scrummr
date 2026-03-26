package com.paradoxon.scrummr.todo

import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/todos")
class TodoController(
    private val todoRepository: TodoRepository,
) {
    @GetMapping
    fun list(): List<Todo> = todoRepository.findAll()

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@Valid @RequestBody request: CreateTodoRequest): Todo =
        todoRepository.create(request.title)

    @PutMapping("/{id}")
    fun update(@PathVariable id: Long, @Valid @RequestBody request: UpdateTodoRequest): Todo =
        todoRepository.update(id, request.title, request.completed)

    @PatchMapping("/{id}/toggle")
    fun toggle(@PathVariable id: Long): Todo = todoRepository.toggle(id)

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@PathVariable id: Long) {
        todoRepository.delete(id)
    }

    @ExceptionHandler(TodoNotFoundException::class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    fun handleTodoNotFound(exception: TodoNotFoundException): Map<String, String> =
        mapOf("error" to (exception.message ?: "Todo not found"))
}
