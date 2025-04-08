/**
 * Control Flow Graph and Call Graph Analyzer
 *
 * This module provides functionality to analyze JavaScript/TypeScript code and generate:
 * 1. Call Graph - showing relationships between functions (who calls whom)
 * 2. Control Flow Graph - showing the execution flow within functions
 */

import * as ts from "typescript";

interface CallGraphNode {
  functionName: string;
  filePath: string;
  called: { functionName: string; filePath: string }[];
}

interface ControlFlowNode {
  nodeType: string;
  content: string;
  children: ControlFlowNode[];
}

interface CFGResult {
  callGraph: CallGraphNode[];
  controlFlowGraphs: {
    [key: string]: ControlFlowNode[];
  };
}

/**
 * Analyzes JavaScript/TypeScript files to generate a call graph and control flow graph
 */
export async function generateCFG(
  fileContents: { path: string; content: string }[],
): Promise<CFGResult> {
  const callGraph: CallGraphNode[] = [];
  const controlFlowGraphs: { [key: string]: ControlFlowNode[] } = {};

  for (const file of fileContents) {
    const fileExtension = file.path.split(".").pop()?.toLowerCase();

    // Only process JavaScript and TypeScript files
    if (fileExtension && ["js", "jsx", "ts", "tsx"].includes(fileExtension)) {
      try {
        // Parse the source file
        const sourceFile = ts.createSourceFile(
          file.path,
          file.content,
          ts.ScriptTarget.Latest,
          true,
        );

        // Analyze the source file and add to results
        analyzeSourceFile(sourceFile, file.path, callGraph, controlFlowGraphs);
      } catch (error) {
        console.error(`Error processing file ${file.path}:`, error);
      }
    }
  }

  return { callGraph, controlFlowGraphs };
}

function analyzeSourceFile(
  sourceFile: ts.SourceFile,
  filePath: string,
  callGraph: CallGraphNode[],
  controlFlowGraphs: { [key: string]: ControlFlowNode[] },
) {
  // Visit all nodes in the source file
  visitNode(sourceFile, sourceFile, filePath, callGraph, controlFlowGraphs);
}

function visitNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
  callGraph: CallGraphNode[],
  controlFlowGraphs: { [key: string]: ControlFlowNode[] },
) {
  // Check if this is a function declaration, function expression, or arrow function
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  ) {
    // Get the function name
    const functionName = getFunctionName(node, sourceFile);

    if (functionName) {
      // Create a call graph node for this function
      const callGraphNode: CallGraphNode = {
        functionName,
        filePath,
        called: [],
      };

      // Find all function calls within this function
      findFunctionCalls(node, sourceFile, filePath, callGraphNode);

      // Add to the call graph
      callGraph.push(callGraphNode);

      // Create a control flow graph for this function
      const cfgNodes = createControlFlowGraph(node, sourceFile);

      // Use a unique key for each function
      const cfgKey = `${filePath}:${functionName}`;
      controlFlowGraphs[cfgKey] = cfgNodes;
    }
  }

  // Recursively visit all child nodes
  ts.forEachChild(node, (child) =>
    visitNode(child, sourceFile, filePath, callGraph, controlFlowGraphs),
  );
}

function getFunctionName(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): string | undefined {
  // For function declarations, get the name directly
  if (ts.isFunctionDeclaration(node) && node.name) {
    return node.name.getText(sourceFile);
  }

  // For method declarations, get the name
  if (ts.isMethodDeclaration(node) && node.name) {
    return node.name.getText(sourceFile);
  }

  // For function expressions assigned to variables
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    const parent = node.parent;

    // Variable declaration: const foo = function() {}
    if (ts.isVariableDeclaration(parent) && parent.name) {
      return parent.name.getText(sourceFile);
    }

    // Property assignment: obj.foo = function() {}
    if (ts.isPropertyAssignment(parent) && parent.name) {
      return parent.name.getText(sourceFile);
    }

    // Binary expression: obj.foo = function() {}
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      parent.left
    ) {
      return parent.left.getText(sourceFile);
    }
  }

  // If no name could be determined, use an anonymous identifier
  return "anonymous_" + node.pos;
}

function findFunctionCalls(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
  callGraphNode: CallGraphNode,
) {
  // Check for call expressions (function calls)
  if (ts.isCallExpression(node)) {
    // Get the called function name
    const calledName = node.expression.getText(sourceFile);

    // Add to the list of called functions
    callGraphNode.called.push({
      functionName: calledName,
      filePath: filePath,
    });
  }

  // Recursively visit all child nodes
  ts.forEachChild(node, (child) =>
    findFunctionCalls(child, sourceFile, filePath, callGraphNode),
  );
}

function createControlFlowGraph(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): ControlFlowNode[] {
  const cfgNodes: ControlFlowNode[] = [];

  // Process the function body
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  ) {
    // Get the function body
    const body = node.body;

    if (body) {
      // If it's a block, process each statement
      if (ts.isBlock(body)) {
        for (const statement of body.statements) {
          const cfgNode = processStatement(statement, sourceFile);
          if (cfgNode) {
            cfgNodes.push(cfgNode);
          }
        }
      }
      // For expression body arrow functions (no braces)
      else {
        const cfgNode: ControlFlowNode = {
          nodeType: "Expression",
          content: body.getText(sourceFile),
          children: [],
        };
        cfgNodes.push(cfgNode);
      }
    }
  }

  return cfgNodes;
}

function processStatement(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): ControlFlowNode | null {
  // Process different statement types
  if (ts.isIfStatement(node)) {
    // Create an if node
    const ifNode: ControlFlowNode = {
      nodeType: "IfStatement",
      content: `if (${node.expression.getText(sourceFile)})`,
      children: [],
    };

    // Process the then statement
    if (node.thenStatement) {
      if (ts.isBlock(node.thenStatement)) {
        for (const statement of node.thenStatement.statements) {
          const childNode = processStatement(statement, sourceFile);
          if (childNode) {
            ifNode.children.push(childNode);
          }
        }
      } else {
        const childNode = processStatement(node.thenStatement, sourceFile);
        if (childNode) {
          ifNode.children.push(childNode);
        }
      }
    }

    // Process the else statement if present
    if (node.elseStatement) {
      const elseNode: ControlFlowNode = {
        nodeType: "ElseStatement",
        content: "else",
        children: [],
      };

      if (ts.isBlock(node.elseStatement)) {
        for (const statement of node.elseStatement.statements) {
          const childNode = processStatement(statement, sourceFile);
          if (childNode) {
            elseNode.children.push(childNode);
          }
        }
      } else {
        const childNode = processStatement(node.elseStatement, sourceFile);
        if (childNode) {
          elseNode.children.push(childNode);
        }
      }

      ifNode.children.push(elseNode);
    }

    return ifNode;
  } else if (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  ) {
    // Create a loop node
    const loopNode: ControlFlowNode = {
      nodeType: "LoopStatement",
      content: node.getText(sourceFile).split("{")[0].trim(),
      children: [],
    };

    // Process the loop body
    const body =
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node)
        ? node.statement
        : null;

    if (body) {
      if (ts.isBlock(body)) {
        for (const statement of body.statements) {
          const childNode = processStatement(statement, sourceFile);
          if (childNode) {
            loopNode.children.push(childNode);
          }
        }
      } else {
        const childNode = processStatement(body, sourceFile);
        if (childNode) {
          loopNode.children.push(childNode);
        }
      }
    }

    return loopNode;
  } else if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
    // Create a loop node
    const loopNode: ControlFlowNode = {
      nodeType: "LoopStatement",
      content: node.getText(sourceFile).split("{")[0].trim(),
      children: [],
    };

    // Process the loop body
    const body = node.statement;

    if (body) {
      if (ts.isBlock(body)) {
        for (const statement of body.statements) {
          const childNode = processStatement(statement, sourceFile);
          if (childNode) {
            loopNode.children.push(childNode);
          }
        }
      } else {
        const childNode = processStatement(body, sourceFile);
        if (childNode) {
          loopNode.children.push(childNode);
        }
      }
    }

    return loopNode;
  } else if (ts.isSwitchStatement(node)) {
    // Create a switch node
    const switchNode: ControlFlowNode = {
      nodeType: "SwitchStatement",
      content: `switch (${node.expression.getText(sourceFile)})`,
      children: [],
    };

    // Process each case clause
    for (const clause of node.caseBlock.clauses) {
      // Case clause
      const caseNode: ControlFlowNode = {
        nodeType: ts.isCaseClause(clause) ? "CaseClause" : "DefaultClause",
        content: clause.getText(sourceFile).split("{")[0].trim(),
        children: [],
      };

      // Process statements in this case
      for (const statement of clause.statements) {
        const childNode = processStatement(statement, sourceFile);
        if (childNode) {
          caseNode.children.push(childNode);
        }
      }

      switchNode.children.push(caseNode);
    }

    return switchNode;
  } else if (ts.isTryStatement(node)) {
    // Create a try node
    const tryNode: ControlFlowNode = {
      nodeType: "TryStatement",
      content: "try",
      children: [],
    };

    // Process the try block
    if (node.tryBlock) {
      for (const statement of node.tryBlock.statements) {
        const childNode = processStatement(statement, sourceFile);
        if (childNode) {
          tryNode.children.push(childNode);
        }
      }
    }

    // Process the catch clause
    if (node.catchClause) {
      const catchNode: ControlFlowNode = {
        nodeType: "CatchClause",
        content: `catch${
          node.catchClause.variableDeclaration
            ? ` (${node.catchClause.variableDeclaration.getText(sourceFile)})`
            : ""
        }`,
        children: [],
      };

      // Process statements in the catch block
      for (const statement of node.catchClause.block.statements) {
        const childNode = processStatement(statement, sourceFile);
        if (childNode) {
          catchNode.children.push(childNode);
        }
      }

      tryNode.children.push(catchNode);
    }

    // Process the finally block
    if (node.finallyBlock) {
      const finallyNode: ControlFlowNode = {
        nodeType: "FinallyClause",
        content: "finally",
        children: [],
      };

      // Process statements in the finally block
      for (const statement of node.finallyBlock.statements) {
        const childNode = processStatement(statement, sourceFile);
        if (childNode) {
          finallyNode.children.push(childNode);
        }
      }

      tryNode.children.push(finallyNode);
    }

    return tryNode;
  }

  // For other statement types
  else if (
    ts.isExpressionStatement(node) ||
    ts.isReturnStatement(node) ||
    ts.isThrowStatement(node) ||
    ts.isVariableStatement(node)
  ) {
    return {
      nodeType: ts.isExpressionStatement(node)
        ? "ExpressionStatement"
        : ts.isReturnStatement(node)
          ? "ReturnStatement"
          : ts.isThrowStatement(node)
            ? "ThrowStatement"
            : "VariableStatement",
      content: node.getText(sourceFile),
      children: [],
    };
  }

  // For block statements (e.g., standalone blocks with { })
  else if (ts.isBlock(node)) {
    const blockNode: ControlFlowNode = {
      nodeType: "Block",
      content: "{...}",
      children: [],
    };

    for (const statement of node.statements) {
      const childNode = processStatement(statement, sourceFile);
      if (childNode) {
        blockNode.children.push(childNode);
      }
    }

    return blockNode;
  }

  // For nodes we don't handle specifically
  return {
    nodeType: "Other",
    content: node.getText(sourceFile),
    children: [],
  };
}

/**
 * Visualizes the call graph in a simple text format
 */
export function visualizeCallGraph(callGraph: CallGraphNode[]): string {
  let result = "## Call Graph\n\n";
  result += "```\n";

  for (const node of callGraph) {
    result += `Function: ${node.functionName} (${node.filePath})\n`;
    if (node.called.length > 0) {
      result += "  Calls:\n";
      for (const called of node.called) {
        result += `    → ${called.functionName} (${called.filePath})\n`;
      }
    } else {
      result += "  Calls: None\n";
    }
    result += "\n";
  }

  result += "```\n";
  return result;
}

/**
 * Visualizes the control flow graph in a simple text format
 */
export function visualizeControlFlowGraphs(controlFlowGraphs: {
  [key: string]: ControlFlowNode[];
}): string {
  let result = "## Control Flow Graphs\n\n";

  for (const [key, nodes] of Object.entries(controlFlowGraphs)) {
    result += `### ${key}\n\n`;
    result += "```\n";

    for (const node of nodes) {
      result += visualizeControlFlowNode(node, 0);
    }

    result += "```\n\n";
  }

  return result;
}

function visualizeControlFlowNode(
  node: ControlFlowNode,
  indent: number,
): string {
  let result = " ".repeat(indent) + `${node.nodeType}: ${node.content}\n`;

  for (const child of node.children) {
    result += visualizeControlFlowNode(child, indent + 2);
  }

  return result;
}
