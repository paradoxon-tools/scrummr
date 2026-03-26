package com.paradoxon.scrummr.todo

class TodoNotFoundException(id: Long) : RuntimeException("Todo with id $id was not found")
