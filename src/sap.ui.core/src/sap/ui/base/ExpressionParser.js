/*!
 * ${copyright}
 */

sap.ui.define(['jquery.sap.global', 'jquery.sap.strings'], function(jQuery/* , jQuerySap1 */) {
	"use strict";
	/*global URI */

	//SAP's Independent Implementation of "Top Down Operator Precedence" by Vaughan R. Pratt,
	//    see http://portal.acm.org/citation.cfm?id=512931
	//Inspired by "TDOP" of Douglas Crockford which is also an implementation of Pratt's article
	//    see https://github.com/douglascrockford/TDOP
	//License granted by Douglas Crockford to SAP, Apache License 2.0
	//    (http://www.apache.org/licenses/LICENSE-2.0)
	//
	//led = "left denotation"
	//lbp = "left binding power", for values see
	//https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_Precedence
	//nud = "null denotation"
	//rbp = "right binding power"
	var fnUndefined = jQuery.proxy(CONSTANT, null, undefined),
		mDefaultGlobals = {
			encodeURIComponent: encodeURIComponent,
			Math: Math,
			odata: {
				fillUriTemplate: function () {
					if (!URI.expand) {
						jQuery.sap.require("sap.ui.thirdparty.URITemplate");
					}
					return URI.expand.apply(URI, arguments).toString();
				},
				uriEncode: function () {
					var ODataUtils;

					jQuery.sap.require("sap.ui.model.odata.ODataUtils");
					ODataUtils = sap.ui.model.odata.ODataUtils;
					return ODataUtils.formatValue.apply(ODataUtils, arguments);
				}
			},
			RegExp: RegExp
		},
		mSymbols = { //symbol table
			"BINDING": {
				led: unexpected,
				nud: function (oToken, oParser) {
					return jQuery.proxy(BINDING, null, oToken.value);
				}
			},
			"IDENTIFIER": {
				led: unexpected,
				nud: function (oToken, oParser) {
					return jQuery.proxy(CONSTANT, null, oParser.globals[oToken.value]);
				}
			},
			"CONSTANT": {
				led: unexpected,
				nud: function (oToken, oParser) {
					return jQuery.proxy(CONSTANT, null, oToken.value);
				}
			},
			".": {
				lbp: 18,
				led: function (oToken, oParser, fnLeft) {
					return jQuery.proxy(DOT, null, fnLeft, oParser.advance("IDENTIFIER").value);
				},
				nud: unexpected
			},
			"(": {
				lbp: 17,
				led: function (oToken, oParser, fnLeft) {
					var aArguments = [],
						bFirst = true;

					while (oParser.current().id !== ")") {
						if (bFirst) {
							bFirst = false;
						} else {
							oParser.advance(","); //consume "," from predecessor argument
						}
						aArguments.push(oParser.expression(0));
					}
					oParser.advance(")");
					return jQuery.proxy(FUNCTION_CALL, null, fnLeft, aArguments);
				},
				nud: function (oToken, oParser) {
					var fnValue = oParser.expression(0);

					oParser.advance(")");
					return fnValue;
				}
			},
			"[": {
				lbp: 18,
				led: function (oToken, oParser, fnLeft) {
					var fnName = oParser.expression(0);

					oParser.advance("]");
					return jQuery.proxy(PROPERTY_ACCESS, null, fnLeft, fnName);
				},
				nud: function (oToken, oParser) {
					var aElements = [],
						bFirst = true;

					while (oParser.current().id !== "]") {
						if (bFirst) {
							bFirst = false;
						} else {
							oParser.advance(","); //consume "," from predecessor element
						}
						aElements.push(
							oParser.current().id === "," ? fnUndefined : oParser.expression(0));
					}
					oParser.advance("]");
					return jQuery.proxy(ARRAY, null, aElements);
				}
			},
			"!": {
				lbp: 15,
				led: unexpected,
				nud: function (oToken, oParser) {
					return jQuery.proxy(UNARY, null, oParser.expression(this.lbp),
						function (x) { return !x; });
				}
			},
			"typeof": {
				lbp: 15,
				led: unexpected,
				nud: function (oToken, oParser) {
					return jQuery.proxy(UNARY, null, oParser.expression(this.lbp),
							function (x) { return typeof x; });
				}
			},
			"?": {
				lbp: 4,
				led: function (oToken, oParser, fnLeft) {
					var fnElse, fnThen;

					fnThen = oParser.expression(this.lbp - 1);
					oParser.advance(":");
					fnElse = oParser.expression(this.lbp - 1);
					return jQuery.proxy(CONDITIONAL, null, fnLeft, fnThen, fnElse);
				},
				nud: unexpected
			},
			")": {
				led: unexpected,
				nud: unexpected
			},
			"]": {
				led: unexpected,
				nud: unexpected
			},
			"{": {
				led: unexpected,
				nud: function (oToken, oParser) {
					var bFirst = true,
						sKey,
						mMap = {},
						fnValue;

					while (oParser.current().id !== "}") {
						if (bFirst) {
							bFirst = false;
						} else {
							oParser.advance(",");
						}
						if (oParser.current() && oParser.current().id === "CONSTANT"
								&& typeof oParser.current().value === "string") {
							sKey = oParser.advance().value;
						} else {
							sKey = oParser.advance("IDENTIFIER").value;
						}
						oParser.advance(":");
						fnValue = oParser.expression(0);
						mMap[sKey] = fnValue;
					}
					oParser.advance("}");
					return jQuery.proxy(MAP, null, mMap);
				}
			},
			"}": {
				lbp: -1, // Note: also terminates end of our input!
				led: unexpected,
				nud: unexpected
			},
			",": {
				led: unexpected,
				nud: unexpected
			},
			":": {
				led: unexpected,
				nud: unexpected
			}
		},
		//Fix length tokens. A token being a prefix of another must come last, e.g. ! after !==
		aTokens = ["===", "!==", "!", "||", "&&", ".", "(", ")", "{", "}", ":", ",", "?", "*",
			"/", "%", "+", "-", "<=", "<", ">=", ">", "[", "]"],
		rTokens;

	jQuery.each(aTokens, function(i, sToken) {
		aTokens[i] = jQuery.sap.escapeRegExp(sToken);
	});
	rTokens = new RegExp(aTokens.join("|"), "g");

	addInfix("*", 14, function (x, y) { return x * y; });
	addInfix("/", 14, function (x, y) { return x / y; });
	addInfix("%", 14, function (x, y) { return x % y; });
	addInfix("+", 13, function (x, y) { return x + y; }).nud = function (oToken, oParser) {
		return jQuery.proxy(UNARY, null, oParser.expression(this.lbp),
			function (x) { return +x; });
	};
	addInfix("-", 13, function (x, y) { return x - y; }).nud = function (oToken, oParser) {
		return jQuery.proxy(UNARY, null, oParser.expression(this.lbp),
				function (x) { return -x; });
	};
	addInfix("<=", 11, function (x, y) { return x <= y; });
	addInfix("<", 11, function (x, y) { return x < y; });
	addInfix(">=", 11, function (x, y) { return x >= y; });
	addInfix(">", 11, function (x, y) { return x > y; });
	addInfix("===", 10, function (x, y) { return x === y; });
	addInfix("!==", 10, function (x, y) { return x !== y; });
	addInfix("&&", 7, function (x, fnY) { return x && fnY(); }, true);
	addInfix("||", 6, function (x, fnY) { return x || fnY(); }, true);

	//Formatter functions to evaluate symbols like literals or operators in the expression grammar
	/**
	 * Formatter function for an array literal.
	 * @param {function[]} aElements - array of formatter functions for the array elements
	 * @param {any[]} aParts - the array of binding values
	 * @return {any[]} - the resulting array literal
	 */
	function ARRAY(aElements, aParts) {
		var aResult = [];

		jQuery.each(aElements, function(i, fnArgument) {
			aResult[i] = fnArgument(aParts);
		});
		return aResult;
	}

	/**
	 * Formatter function for an embedded binding.
	 * @param {number} i - the index of the binding as it appears when reading the
	 *   expression from the left
	 * @param {any[]} aParts - the array of binding values
	 * @returns {any} the binding value
	 */
	function BINDING(i, aParts) {
		return aParts[i];
	}

	/**
	 * Formatter function for executing the conditional operator with the given condition, "then"
	 * and "else" clause.
	 * @param {function} fnCondition - formatter function for the condition
	 * @param {function} fnThen - formatter function for the "then" clause
	 * @param {function} fnElse- formatter function for the "else" clause
	 * @param {any[]} aParts - the array of binding values
	 * @return {any} - the value of the "then" or "else" clause, depending on the value of the
	 *   condition
	 */
	function CONDITIONAL(fnCondition, fnThen, fnElse, aParts) {
		return fnCondition(aParts) ? fnThen(aParts) : fnElse(aParts);
	}

	/**
	 * Formatter function for any constant value such as a literal or identifier.
	 * @param {any} v - any value
	 * @returns {any} the given value
	 */
	function CONSTANT(v) {
		return v;
	}

	/**
	 * Formatter function for member access via the dot operator.
	 * @param {function} fnLeft - formatter function for the left operand
	 * @param {string} sIdentifier - the identifier on the dot's right side
	 * @param {any[]} aParts - the array of binding values
	 * @return {any} - the left operand's member with the name
	 */
	function DOT(fnLeft, sIdentifier, aParts) {
		var oParent = fnLeft(aParts),
			vChild = oParent[sIdentifier];
		// Note: jQuery.proxy() cannot handle this in case typeof oParent === "string"
		return typeof vChild === "function" ? vChild.bind(oParent) : vChild;
	}

	/**
	 * Formatter function for a call to the function returned by fnLeft.
	 * @param {function} fnLeft - formatter function for the left operand: the function to call
	 * @param {function[]} aArguments - array of formatter functions for the arguments
	 * @param {any[]} aParts - the array of binding values
	 * @return {any} - the return value of the function applied to the arguments
	 */
	function FUNCTION_CALL(fnLeft, aArguments, aParts) {
		var aResult = [];

		jQuery.each(aArguments, function(i, fnArgument) {
			aResult[i] = fnArgument(aParts); // evaluate argument
		});
		// evaluate function expression and call it
		return fnLeft(aParts).apply(null, aResult);
	}

	/**
	 * Formatter function for an infix operator.
	 *
	 * @param {function} fnLeft - formatter function for the left operand
	 * @param {function} fnRight - formatter function for the right operand
	 * @param {function} fnOperator
	 *   function taking two arguments which evaluates the infix operator
	 * @param {boolean} bLazy - whether the right operand is e
	 * @param {any[]} aParts - the array of binding values
	 * @return {any} - the result of the operator function applied to the two operands
	 */
	function INFIX(fnLeft, fnRight, fnOperator, bLazy, aParts) {
		return fnOperator(fnLeft(aParts),
			bLazy ? jQuery.proxy(fnRight, null, aParts) : fnRight(aParts));
	}

	/**
	 * Formatter function for an object literal.
	 * @param {object} mMap - map from key to formatter functions for the values
	 * @param {any[]} aParts - the array of binding values
	 * @return {object} - the resulting map
	 */
	function MAP(mMap, aParts) {
		var mResult = {};

		jQuery.each(mMap, function(sKey, fnValue) {
			mResult[sKey] = fnValue(aParts); // evaluate value
		});
		return mResult;
	}

	/**
	 * Formatter function for a property access.
	 * @param {function} fnLeft - formatter function for the left operand: the array or object to
	 *   access
	 * @param {function} fnName - formatter function for the property name
	 * @param {any[]} aParts - the array of binding values
	 * @return {any} - the array element or object property
	 */
	function PROPERTY_ACCESS(fnLeft, fnName, aParts) {
		return fnLeft(aParts)[fnName(aParts)];
	}

	/**
	 * Formatter function for a unary operator.
	 *
	 * @param {function} fnRight - formatter function for the operand
	 * @param {function} fnOperator
	 *   function to evaluate the unary operator taking one argument
	 * @param {any[]} aParts - the array of binding values
	 * @return {any} - the result of the operator function applied to the operand
	 */
	function UNARY(fnRight, fnOperator, aParts) {
		return fnOperator(fnRight(aParts));
	}

	/**
	 * Adds the infix operator with the given id, binding power and formatter function to the
	 * symbol table.
	 * @param {string} sId - the id of the infix operator
	 * @param {number} iBindingPower - the binding power = precedence of the infix operator
	 * @param {function} fnOperator - the function to evaluate the operator
	 * @param {boolean} [bLazy=false] - whether the right operand is lazily evaluated
	 * @return {object} the newly created symbol for the infix operator
	 */
	function addInfix(sId, iBindingPower, fnOperator, bLazy) {
		mSymbols[sId] = {
			lbp: iBindingPower,
			led: function (oToken, oParser, fnLeft) {
				//lazy evaluation is right associative: performance optimization for guard and
				//default operator, e.g. true || A || B || C does not execute the || for B and C
				var rbp = bLazy ? this.lbp - 1 : this.lbp;

				return jQuery.proxy(INFIX, null, fnLeft, oParser.expression(rbp),
					fnOperator, bLazy);
			},
			nud: unexpected
		};
		return mSymbols[sId];
	}

	/**
	 * Throws a SyntaxError with the given <code>sMessage</code> as <code>message</code>, its
	 * <code>at</code> property set to <code>iAt</code> and its <code>text</code> property to
	 * <code>sInput</code>.
	 * In addition, logs a corresponding error message to the console with <code>sInput</code>
	 * as details.
	 *
	 * @param {string} sMessage - the error message
	 * @param {string} sInput - the input string
	 * @param {number} [iAt] - the index in the input string where the error occurred; the index
	 *   starts counting at 1 to be consistent with positions provided in tokenizer error messages.
	 */
	function error(sMessage, sInput, iAt) {
		var oError = new SyntaxError(sMessage);

		oError.at = iAt;
		oError.text = sInput;
		if (iAt !== undefined) {
			sMessage += " at position " + iAt;
		}
		jQuery.sap.log.error(sMessage, sInput, "sap.ui.base.ExpressionParser");
		throw oError;
	}

	/**
	 * Throws and logs an error for the unexpected token oToken.
	 * @param {object} oToken - the unexpected token
	 */
	function unexpected(oToken) {
		var sToken = oToken.input.slice(oToken.start, oToken.end);

		error("Unexpected " + oToken.id + (sToken !== oToken.id ? ": " + sToken : ""),
			oToken.input,
			oToken.start + 1 /*position for error starts counting at 1*/);
	}

	/**
	 * Computes the tokens according to the expression grammar in sInput starting at iStart and
	 * uses fnResolveBinding to resolve bindings embedded in the expression.
	 * @param {function} fnResolveBinding - the function to resolve embedded bindings
	 * @param {string} sInput - the string to be parsed
	 * @param {number} [iStart=0] - the index to start parsing
	 * @returns {object} Tokenization result object with the following properties
	 *   at: the index after the last character consumed by the tokenizer in the input string
	 *   parts: array with parts corresponding to resolved embedded bindings
	 *   tokens: the array of tokens where each token is a tuple of ID, optional value, and
	 *   optional source text
	 */
	function tokenize(fnResolveBinding, sInput, iStart) {
		var aParts = [],
			aTokens = [],
			oTokenizer = jQuery.sap._createJSTokenizer();

		/**
		 * Consumes the next token in the input string and pushes it to the array of tokens.
		 * @returns {boolean} whether a token is recognized
		 */
		function consumeToken() {
			var ch, oBinding, iIndex, aMatches, oToken;

			oTokenizer.white();
			ch = oTokenizer.getCh();
			iIndex = oTokenizer.getIndex();

			if (/[a-z]/i.test(ch)) {
				aMatches = /[a-z]\w*/i.exec(sInput.slice(iIndex));
				if (aMatches[0] === "false"
					|| aMatches[0] === "null"
					|| aMatches[0] === "true") {
					oToken = {id: "CONSTANT", value: oTokenizer.word()};
				} else if (aMatches[0] === "typeof") {
					oToken = {id: "typeof"};
					oTokenizer.setIndex(iIndex + aMatches[0].length);
				} else {
					oToken = {id: "IDENTIFIER", value: aMatches[0]};
					oTokenizer.setIndex(iIndex + aMatches[0].length);
				}
			} else if (/\d/.test(ch)
					|| ch === "." && /\d/.test(sInput.charAt(oTokenizer.getIndex() + 1))) {
				oToken = {id: "CONSTANT", value: oTokenizer.number()};
			} else if (ch === "'" || ch === '"') {
				oToken = {id: "CONSTANT", value: oTokenizer.string()};
			} else if (ch === "$") {
				oTokenizer.next("$");
				oTokenizer.next("{"); //binding
				oBinding = fnResolveBinding(sInput, oTokenizer.getIndex() - 1);
				oToken = {
					id: "BINDING",
					value: aParts.length
				};
				aParts.push(oBinding.result);
				oTokenizer.setIndex(oBinding.at); //go to first character after binding string
			} else {
				rTokens.lastIndex = iIndex;
				aMatches = rTokens.exec(sInput);
				if (!aMatches || aMatches.index !== iIndex) {
					return false; // end of input or unrecognized character
				}
				oToken = {id: aMatches[0]};
				oTokenizer.setIndex(iIndex + aMatches[0].length);
			}
			oToken.input = sInput;
			oToken.start = iIndex;
			oToken.end = oTokenizer.getIndex();
			aTokens.push(oToken);
			return true;
		}

		oTokenizer.init(sInput, iStart);

		try {
			/* eslint-disable no-empty */
			while (consumeToken()) { /* deliberately empty */ }
			/* eslint-enable no-empty */
		} catch (e) {
			if (e.name === "SyntaxError") { //handle tokenizer errors
				error(e.message, e.text, e.at);
			} else {
				throw e;
			}
		}

		return {
			at: oTokenizer.getIndex(),
			parts: aParts,
			tokens: aTokens
		};
	}

	/**
	 * Parses expression tokens to a result object as specified to be returned by
	 * {@link sap.ui.base.ExpressionParser#parse}.
	 * @param {object[]} aTokens - the array with the tokens
	 * @param {string} sInput - the expression string (used when logging errors)
	 * @param {object} mGlobals - the map of global variables
	 * @returns {object} the parse result with the following properties
	 *   formatter: the formatter function to evaluate the expression which
	 *     takes the parts corresponding to bindings embedded in the expression as
	 *     parameters; undefined in case of an invalid expression
	 *   at: the index of the first character after the expression in sInput
	 */
	function parse(aTokens, sInput, mGlobals) {
		var fnFormatter,
			iNextToken = 0,
			oParser = {
				advance: advance,
				current: current,
				expression: expression,
				globals: mGlobals
			},
			oToken;

		/**
		 * Returns the next token in the array of tokens and advances the index in this array.
		 * Throws an error if the next token's ID is not equal to the optional
		 * <code>sExpectedTokenId</code>.
		 * @param {string} [sExpectedTokenId] - the expected id of the next token
		 * @returns {object} - the next token or undefined if all tokens have been read
		 */
		function advance(sExpectedTokenId) {
			var oToken = aTokens[iNextToken];

			if (sExpectedTokenId) {
				if (!oToken) {
					error("Expected " + sExpectedTokenId + " but instead saw end of input",
						sInput);
				} else if (oToken.id !== sExpectedTokenId) {
					error("Expected " + sExpectedTokenId + " but instead saw "
							+ sInput.slice(oToken.start, oToken.end),
						sInput,
						oToken.start + 1);
				}
			}
			iNextToken += 1;
			return oToken;
		}

		/**
		 * Returns the next token in the array of tokens, but does not advance the index.
		 * @returns {object} - the next token or undefined if all tokens have been read
		 */
		function current() {
			return aTokens[iNextToken];
		}

		/**
		 * Parse an expression starting at the current token. Throws an error if there are no more
		 * tokens and
		 *
		 * @param {number} rbp
		 *   a "right binding power"
		 * @returns {function} The formatter function for the expression
		 */
		function expression(rbp) {
			var fnLeft;

			oToken = advance();
			if (!oToken) {
				error("Expected expression but instead saw end of input", sInput);
			}
			fnLeft = mSymbols[oToken.id].nud(oToken, oParser);

			while (iNextToken < aTokens.length) {
				oToken = current();
				if (rbp >= (mSymbols[oToken.id].lbp || 0)) {
					break;
				}
				advance();
				fnLeft = mSymbols[oToken.id].led(oToken, oParser, fnLeft);
			}

			return fnLeft;
		}

		//TODO allow short read by passing 0 (do it if iStart is provided below)
		fnFormatter = expression(-1); // -1 = "greedy read"
		return {
			at: current() ? current().start : undefined,
			formatter: fnFormatter
		};
	}

	/**
	 * The parser to parse expressions in bindings.
	 *
	 * @alias sap.ui.base.ExpressionParser
	 * @private
	 */
	return {
		/**
		 * Parses a string <code>sInput</code> with an expression based on the syntax sketched
		 * below.
		 *
		 * If a start index <code>iStart</code> for parsing is provided, the input string is parsed
		 * starting from this index and the return value contains the index after the last
		 * character belonging to the expression.
		 *
		 * If <code>iStart</code> is undefined the complete string is parsed; in this case
		 * a <code>SyntaxError</code> is thrown if it does not comply to the expression syntax.
		 *
		 * The expression syntax is a subset of JavaScript expression syntax with the
		 * enhancement that the only "variable" parts in an expression are bindings.
		 * The following expression constructs are supported: <ul>
		 * <li> String literal enclosed in single or double quotes, e.g. 'foo' </li>
		 * <li> Null and Boolean literals: null, true, false </li>
		 * <li> Object and number literals, e.g. {foo:'bar'} and 3.141 </li>
		 * <li> Grouping, e.g. a * (b + c)</li>
		 * <li> Unary operators !,  +, -, typeof </li>
		 * <li> Multiplicative Operators: *, /, % </li>
		 * <li> Additive Operators: +, - </li>
		 * <li> Relational Operators: <, >, <=, >= </li>
		 * <li> Strict Equality Operators: ===, !== </li>
		 * <li> Binary Logical Operators: &&, || </li>
		 * <li> Conditional Operator: ? : </li>
		 * <li> Member access via . operator </li>
		 * <li> Function call </li>
		 * <li> Embedded binding to refer to model contents, e.g. ${myModel>/Address/city} </li>
		 * <li> Global functions and objects: encodeURIComponent, Math, RegExp </li>
		 * <li> Property Access via [, e.g. ['foo', 'bar'][0] </li>
		 * <li> Array literal, e.g. ['foo', 'bar'] </li>
		 * </ul>
		 *
		 * @param {function} fnResolveBinding - the function to resolve embedded bindings
		 * @param {string} sInput - the string to be parsed
		 * @param {number} [iStart=0] - the index to start parsing
		 * @param {object} [mGlobals]
		 *   global variables allowed in the expression as map of variable name to its value
		 * @returns {object} the parse result with the following properties
		 *   result: object with the properties
		 *     formatter: the formatter function to evaluate the expression which
		 *       takes the parts corresponding to bindings embedded in the expression as
		 *       parameters
		 *     parts: the array of parts contained in the expression string which is
		 *       empty if no parts exist
		 *   at: the index of the first character after the expression in sInput
		 * @throws SyntaxError
		 *   If the expression string is invalid or unsupported. The at property of
		 *   the error contains the position where parsing failed.
		 */
		parse: function (fnResolveBinding, sInput, iStart, mGlobals) {
			var oResult, oTokens;

			oTokens = tokenize(fnResolveBinding, sInput, iStart);
			oResult = parse(oTokens.tokens, sInput, mGlobals || mDefaultGlobals);

			//TODO TDD replace !iStart by iStart === undefined
			if (!iStart && oTokens.at < sInput.length) {
				error("Invalid token in expression", sInput, oTokens.at);
			}
			if (!oTokens.parts.length) {
				return {
					constant: oResult.formatter(),
					at: oResult.at || oTokens.at
				};
			}

			function formatter() {
				//make separate parameters for parts one (array like) parameter
				// TODO stringify the result?
				return oResult.formatter(arguments);
			}
			formatter.textFragments = true; //use CompositeBinding even if there is only one part
			return {
				result: {
					formatter: formatter,
					parts: oTokens.parts
					//TODO useRawValues: true --> use JS object instead of formatted String
				},
				at: oResult.at || oTokens.at
			};
		}
	};
}, /* bExport= */ true);
