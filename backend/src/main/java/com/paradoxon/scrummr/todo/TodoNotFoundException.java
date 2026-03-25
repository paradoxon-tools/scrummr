package com.paradoxon.scrummr.todo;

public class TodoNotFoundException extends RuntimeException {
    public TodoNotFoundException(long id) {
        super("Todo with id %d was not found".formatted(id));
    }
}
