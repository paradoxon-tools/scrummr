package com.paradoxon.scrummr

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

@SpringBootApplication
class ScrummrApplication

fun main(args: Array<String>) {
    runApplication<ScrummrApplication>(*args)
}
