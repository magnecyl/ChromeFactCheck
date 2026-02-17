using System.Text.Json;
using ChromeFactCheck.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.JsonSerializerOptions.WriteIndented = true;
    });

builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();

builder.Services.AddCors(options =>
{
    options.AddPolicy("ExtensionCors", policy =>
    {
        var configuredOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>();

        if (configuredOrigins is { Length: > 0 })
        {
            policy.WithOrigins(configuredOrigins).AllowAnyHeader().AllowAnyMethod();
            return;
        }

        policy
            .SetIsOriginAllowed(static origin =>
                origin.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase) ||
                origin.StartsWith("http://localhost", StringComparison.OrdinalIgnoreCase) ||
                origin.StartsWith("https://localhost", StringComparison.OrdinalIgnoreCase))
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

builder.Services.AddHttpClient("llm");
builder.Services.AddHttpClient("retrieval");
builder.Services.AddScoped<SourceRetrievalService>();
builder.Services.AddScoped<IFactCheckOrchestrator, FactCheckOrchestrator>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseExceptionHandler();
app.UseHttpsRedirection();
app.UseCors("ExtensionCors");

app.MapGet("/api/health", () => Results.Ok(new
{
    status = "ok",
    utcTime = DateTimeOffset.UtcNow
}));

app.MapControllers();

app.Run();
