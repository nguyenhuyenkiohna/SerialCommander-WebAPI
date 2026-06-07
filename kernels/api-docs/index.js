const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
const path = require("path");

const options = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "Serial Commander API",
            version: "1.0.0",
            description: "API documentation for Serial Commander application",
        },
        servers: [
            {
                url: "http://localhost:2999",
                description: "Development server",
            },
        ],
        paths: {
            "/": {
                get: {
                    summary: "Thông tin tổng quan API",
                    tags: ["System"],
                    responses: {
                        200: {
                            description: "Thông tin trạng thái API",
                            content: {
                                "application/json": {
                                    schema: { $ref: "#/components/schemas/RootSuccessResponse" },
                                },
                            },
                        },
                    },
                },
            },
        },
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT",
                },
            },
            schemas: {
                ErrorResponse: {
                    type: "object",
                    required: ["message", "error"],
                    properties: {
                        message: { type: "string" },
                        trace_id: {
                            type: "string",
                            description: "Mã bắc cầu request (trùng header X-Request-Id) khi có requestTraceMiddleware.",
                        },
                        error: {
                            type: "object",
                            required: ["code", "message"],
                            properties: {
                                code: {
                                    type: "string",
                                    description: "Ví dụ RATE_LIMIT_EXCEEDED, NO_TOKEN, VALIDATION_FAILED.",
                                },
                                message: { type: "string" },
                                details: {},
                            },
                        },
                    },
                },
                ScenarioListSuccessResponse: {
                    type: "object",
                    required: ["message", "scenarios"],
                    properties: {
                        message: { type: "string" },
                        trace_id: { type: "string" },
                        scenarios: {
                            type: "array",
                            items: { type: "object", additionalProperties: true },
                        },
                    },
                },
                ScenarioMergedResourceSuccessResponse: {
                    type: "object",
                    required: ["message"],
                    description:
                        "Kịch bản: sendSuccess merge DTO — Name, Content, Banners, ... cùng cấp với message (client cũ vẫn đọc field kịch bản ở root).",
                    properties: {
                        message: { type: "string" },
                        trace_id: { type: "string" },
                    },
                    additionalProperties: true,
                },
                LoginSuccessResponse: {
                    type: "object",
                    required: ["message", "token"],
                    properties: {
                        message: { type: "string", example: "Đăng nhập thành công" },
                        token: { type: "string" },
                    },
                },
                RegisterSuccessResponse: {
                    type: "object",
                    required: ["message", "requireEmailVerification", "email", "emailSent"],
                    properties: {
                        message: { type: "string" },
                        requireEmailVerification: { type: "boolean" },
                        email: { type: "string", format: "email" },
                        emailSent: { type: "boolean" },
                    },
                },
                MessageSuccessResponse: {
                    type: "object",
                    required: ["message"],
                    properties: {
                        message: { type: "string" },
                    },
                },
                VerifyResetCodeSuccessResponse: {
                    type: "object",
                    required: ["message", "valid"],
                    properties: {
                        message: { type: "string" },
                        valid: { type: "boolean" },
                    },
                },
                ScenarioVerifySuccessResponse: {
                    type: "object",
                    required: ["message", "errors", "warnings"],
                    properties: {
                        message: { type: "string" },
                        errors: { type: "array", items: { type: "string" } },
                        warnings: { type: "array", items: { type: "string" } },
                    },
                },
                ScenarioVerifyFileSuccessResponse: {
                    type: "object",
                    required: ["message", "valid", "errors", "warnings"],
                    properties: {
                        message: { type: "string" },
                        valid: { type: "boolean" },
                        errors: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    message: { type: "string" },
                                    path: { type: "string" },
                                    line: { type: "number" },
                                    column: { type: "number" },
                                },
                            },
                        },
                        warnings: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    message: { type: "string" },
                                    path: { type: "string" },
                                },
                            },
                        },
                    },
                },
                RootSuccessResponse: {
                    type: "object",
                    required: ["message", "version", "endpoints", "status"],
                    properties: {
                        message: { type: "string" },
                        trace_id: {
                            type: "string",
                            description: "Mã bắc cầu request (trùng header X-Request-Id).",
                        },
                        version: { type: "string" },
                        endpoints: { type: "object" },
                        status: { type: "string" },
                    },
                },
                SyncJobsOpsSummary: {
                    type: "object",
                    properties: {
                        generated_at: { type: "string", format: "date-time" },
                        by_status: {
                            type: "object",
                            additionalProperties: { type: "integer" },
                        },
                        due_for_processing: { type: "integer" },
                        failed_recent: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    id: { type: "string" },
                                    operation_type: { type: "string" },
                                    scenario_id: { type: "string" },
                                    retry_count: { type: "integer" },
                                    last_error: { type: "string", nullable: true },
                                    modified_at: { type: "string", format: "date-time", nullable: true },
                                },
                            },
                        },
                    },
                },
                SyncJobsOpsSummaryEnvelope: {
                    type: "object",
                    required: ["message", "summary"],
                    properties: {
                        message: { type: "string" },
                        trace_id: { type: "string" },
                        summary: { $ref: "#/components/schemas/SyncJobsOpsSummary" },
                    },
                },
                AppOpsMetricsEnvelope: {
                    type: "object",
                    required: ["message", "metrics"],
                    properties: {
                        message: { type: "string" },
                        trace_id: { type: "string" },
                        metrics: {
                            type: "object",
                            properties: {
                                generated_at: { type: "string", format: "date-time" },
                                counters: { type: "object", additionalProperties: { type: "number" } },
                                gauges: { type: "object", additionalProperties: { type: "number" } },
                            },
                        },
                    },
                },
            },
        },
    },
    // Đọc JSDoc comments từ các file routes và controllers
    apis: [
        path.join(__dirname, "../../routes/*.js"),
        path.join(__dirname, "../../modules/**/*.js"),
    ],
};

const openapiSpecification = swaggerJsdoc(options);

module.exports = {
    swaggerUIServe: swaggerUi.serve,
    swaggerUISetup: swaggerUi.setup(openapiSpecification),
    openapiSpecification,
};